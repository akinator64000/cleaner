// hooks/use-nft-enrichment.ts
import { useEffect, useMemo, useState } from 'react'
import { Connection } from '@solana/web3.js'
import { HeliusAsset } from '@/types/helius'
import { resolveNftMeta, pickImageFromHeliusAsset } from '@/utils/resolve-nft-meta'

type Result = { nfts: HeliusAsset[]; isEnriching: boolean }

export function useNftEnrichment(connection: Connection, rawNfts: HeliusAsset[]): Result {
  const [nfts, setNfts] = useState<HeliusAsset[]>(rawNfts)
  const [isEnriching, setIsEnriching] = useState(false)

  useEffect(() => {
    setNfts(rawNfts)
  }, [rawNfts])

  const queue = useMemo(() => {
    const isCompressed = (a: HeliusAsset) => a?.compression?.compressed === true || a.interface === 'CompressedNFT'
    return rawNfts.filter((a) => {
      const img = !!pickImageFromHeliusAsset(a) || !!a?.content?.links?.image
      const hasName = !!a?.content?.metadata?.name
      if (isCompressed(a)) {
        return !img && !!a?.content?.json_uri
      }
      return !(img && hasName)
    })
  }, [rawNfts])

  useEffect(() => {
    let aborted = false
    if (queue.length === 0) {
      setIsEnriching(false)
      return
    }

    const BATCH = 24
    const SLEEP_MS = 120
    let idx = 0

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const run = async () => {
      setIsEnriching(true)
      try {
        while (idx < queue.length && !aborted) {
          const slice = queue.slice(idx, idx + BATCH)
          idx += BATCH

          const enriched = await Promise.all(
            slice.map(async (a) => {
              try {
                const meta = await resolveNftMeta(connection, a)
                const image = meta.image ?? a?.content?.links?.image
                const name = meta.name ?? a?.content?.metadata?.name
                const json = meta.jsonUri ?? a?.content?.json_uri
                if (!image && !name && !json) return a
                return {
                  ...a,
                  content: {
                    ...(a.content ?? {}),
                    json_uri: json,
                    metadata: { ...(a.content?.metadata ?? {}), ...(name ? { name } : {}) },
                    links: { ...(a.content?.links ?? {}), ...(image ? { image } : {}) },
                  },
                } as HeliusAsset
              } catch {
                return a
              }
            }),
          )

          if (aborted) break

          setNfts((curr) => {
            const byId = new Map(enriched.map((e) => [e.id, e]))
            return curr.map((c) => byId.get(c.id) ?? c)
          })

          if (idx < queue.length) await sleep(SLEEP_MS)
        }
      } finally {
        if (!aborted) setIsEnriching(false)
      }
    }

    run()
    return () => {
      aborted = true
    }
  }, [connection, queue])

  return { nfts, isEnriching }
}
