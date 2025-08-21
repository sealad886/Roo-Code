import { VectorStoreSearchResult } from "./vector-store"

/**
 * Input data for re-ranking a list of search results
 */
export interface RerankRequest {
	query: string
	results: VectorStoreSearchResult[]
}

/**
 * Response from re-ranking service
 */
export interface RerankResponse {
	results: VectorStoreSearchResult[]
}

/**
 * Configuration for re-ranking service
 */
export interface RerankConfig {
	endpoint: string
	apiKey?: string
	timeoutMs: number
}

/**
 * Interface for re-ranking services that can reorder search results
 * based on relevance to the query using more sophisticated algorithms
 */
export interface IReranker {
	/**
	 * Re-ranks search results based on the query
	 * @param request The re-ranking request containing query and initial results
	 * @returns Promise resolving to re-ranked results
	 * @throws Error if re-ranking fails or times out
	 */
	rerank(request: RerankRequest): Promise<RerankResponse>

	/**
	 * Checks if the re-ranking service is properly configured and accessible
	 * @returns Promise resolving to boolean indicating if service is available
	 */
	isAvailable(): Promise<boolean>
}
