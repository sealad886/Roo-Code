import { IReranker, RerankRequest, RerankResponse, RerankConfig } from "../interfaces/reranker"
import { VectorStoreSearchResult } from "../interfaces/vector-store"

/**
 * HTTP-based reranker that sends requests to external re-ranking endpoints
 */
export class HttpReranker implements IReranker {
	constructor(private readonly config: RerankConfig) {}

	async rerank(request: RerankRequest): Promise<RerankResponse> {
		const { query, results } = request
		const { endpoint, apiKey, timeoutMs } = this.config

		// Create abort controller for timeout
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

		try {
			// Prepare the request body
			const requestBody = {
				query,
				documents: results.map((result) => ({
					id: result.id,
					text: result.payload?.codeChunk || "",
					metadata: {
						filePath: result.payload?.filePath,
						startLine: result.payload?.startLine,
						endLine: result.payload?.endLine,
						originalScore: result.score,
					},
				})),
			}

			// Prepare headers
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			}

			if (apiKey) {
				headers.Authorization = `Bearer ${apiKey}`
			}

			// Make the HTTP request
			const response = await fetch(endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify(requestBody),
				signal: controller.signal,
			})

			clearTimeout(timeoutId)

			if (!response.ok) {
				throw new Error(`Re-ranking service returned ${response.status}: ${response.statusText}`)
			}

			const responseData = await response.json()

			// Validate response structure
			if (!responseData || !Array.isArray(responseData.documents)) {
				throw new Error("Invalid response format from re-ranking service")
			}

			// Convert response back to VectorStoreSearchResult format
			const rerankedResults: VectorStoreSearchResult[] = responseData.documents.map((doc: any) => {
				// Find the original result to preserve payload
				const originalResult = results.find((r) => r.id === doc.id)
				if (!originalResult) {
					throw new Error(`Re-ranking service returned unknown document ID: ${doc.id}`)
				}

				return {
					...originalResult,
					score: doc.score || doc.relevance_score || originalResult.score, // Handle different response formats
				}
			})

			return { results: rerankedResults }
		} catch (error) {
			clearTimeout(timeoutId)

			if (error.name === "AbortError") {
				throw new Error(`Re-ranking request timed out after ${timeoutMs}ms`)
			}

			// Re-throw other errors with context
			throw new Error(`Re-ranking failed: ${error.message}`)
		}
	}

	async isAvailable(): Promise<boolean> {
		const { endpoint, timeoutMs } = this.config

		// Create abort controller for timeout
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), Math.min(timeoutMs, 5000)) // Use shorter timeout for health check

		try {
			// Try to make a simple HEAD or GET request to check if endpoint is accessible
			const response = await fetch(endpoint, {
				method: "HEAD",
				signal: controller.signal,
			})

			clearTimeout(timeoutId)

			// Consider 2xx and 405 (Method Not Allowed) as available
			// 405 means the endpoint exists but doesn't support HEAD
			return response.status < 500 && (response.status < 400 || response.status === 405)
		} catch (error) {
			clearTimeout(timeoutId)
			return false
		}
	}
}
