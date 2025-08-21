import * as path from "path"
import { VectorStoreSearchResult } from "./interfaces"
import { IEmbedder } from "./interfaces/embedder"
import { IVectorStore } from "./interfaces/vector-store"
import { IReranker } from "./interfaces/reranker"
import { CodeIndexConfigManager } from "./config-manager"
import { CodeIndexStateManager } from "./state-manager"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"

/**
 * Service responsible for searching the code index.
 */
export class CodeIndexSearchService {
	constructor(
		private readonly configManager: CodeIndexConfigManager,
		private readonly stateManager: CodeIndexStateManager,
		private readonly embedder: IEmbedder,
		private readonly vectorStore: IVectorStore,
		private readonly reranker?: IReranker,
	) {}

	/**
	 * Searches the code index for relevant content.
	 * @param query The search query
	 * @param limit Maximum number of results to return
	 * @param directoryPrefix Optional directory path to filter results by
	 * @returns Array of search results
	 * @throws Error if the service is not properly configured or ready
	 */
	public async searchIndex(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
		if (!this.configManager.isFeatureEnabled || !this.configManager.isFeatureConfigured) {
			throw new Error("Code index feature is disabled or not configured.")
		}

		const minScore = this.configManager.currentSearchMinScore
		const maxResults = this.configManager.currentSearchMaxResults

		const currentState = this.stateManager.getCurrentStatus().systemStatus
		if (currentState !== "Indexed" && currentState !== "Indexing") {
			// Allow search during Indexing too
			throw new Error(`Code index is not ready for search. Current state: ${currentState}`)
		}

		try {
			// Generate embedding for query
			const embeddingResponse = await this.embedder.createEmbeddings([query])
			const vector = embeddingResponse?.embeddings[0]
			if (!vector) {
				throw new Error("Failed to generate embedding for query.")
			}

			// Handle directory prefix
			let normalizedPrefix: string | undefined = undefined
			if (directoryPrefix) {
				normalizedPrefix = path.normalize(directoryPrefix)
			}

			// Perform initial vector search
			let results = await this.vectorStore.search(vector, normalizedPrefix, minScore, maxResults)

			// Apply re-ranking if configured and available
			if (this.reranker && results.length > 0) {
				try {
					// Determine caps from config manager
					const embedderMax = this.configManager.currentSearchMaxResults
					const rerankerMax = this.configManager.rerankingMaxResults
					let effectiveMax: number | undefined = undefined
					if (rerankerMax !== undefined && rerankerMax !== null) {
						effectiveMax =
							embedderMax !== undefined && embedderMax !== null
								? Math.min(rerankerMax, embedderMax)
								: rerankerMax
					}

					// Slice results to the effective max to avoid sending too many items to the reranker
					let resultsToRerank = results
					if (effectiveMax !== undefined && effectiveMax !== null) {
						resultsToRerank = results.slice(0, effectiveMax)
					}

					const rerankResponse = await this.reranker.rerank({
						query,
						results: resultsToRerank,
					})

					// Replace results with reranked results. Note: downstream logic expects ordering preserved.
					results = rerankResponse.results
					console.log(`[CodeIndexSearchService] Applied re-ranking to ${results.length} results`)
				} catch (rerankError) {
					// Log re-ranking error but continue with original results
					console.warn("[CodeIndexSearchService] Re-ranking failed, using original results:", rerankError)

					// Capture telemetry for the re-ranking error
					TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
						error: (rerankError as Error).message,
						stack: (rerankError as Error).stack,
						location: "searchIndex_reranking",
					})
				}
			}

			return results
		} catch (error) {
			console.error("[CodeIndexSearchService] Error during search:", error)
			this.stateManager.setSystemState("Error", `Search failed: ${(error as Error).message}`)

			// Capture telemetry for the error
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: (error as Error).message,
				stack: (error as Error).stack,
				location: "searchIndex",
			})

			throw error // Re-throw the error after setting state
		}
	}
}
