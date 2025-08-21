import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { HttpReranker } from "../http-reranker"
import { RerankRequest, RerankConfig } from "../../interfaces/reranker"
import { VectorStoreSearchResult } from "../../interfaces/vector-store"

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe("HttpReranker", () => {
	let reranker: HttpReranker
	let config: RerankConfig
	let mockRequest: RerankRequest

	beforeEach(() => {
		config = {
			endpoint: "https://api.example.com/rerank",
			apiKey: "test-api-key",
			timeoutMs: 5000,
		}
		reranker = new HttpReranker(config)

		mockRequest = {
			query: "test query",
			results: [
				{
					id: "1",
					score: 0.8,
					payload: {
						filePath: "/test/file1.ts",
						codeChunk: "function test1() {}",
						startLine: 1,
						endLine: 3,
					},
				},
				{
					id: "2",
					score: 0.6,
					payload: {
						filePath: "/test/file2.ts",
						codeChunk: "function test2() {}",
						startLine: 5,
						endLine: 7,
					},
				},
			] as VectorStoreSearchResult[],
		}

		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("rerank", () => {
		it("should successfully rerank results", async () => {
			const mockResponse = {
				documents: [
					{ id: "2", score: 0.9 },
					{ id: "1", score: 0.7 },
				],
			}

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			})

			const result = await reranker.rerank(mockRequest)

			expect(mockFetch).toHaveBeenCalledWith(
				config.endpoint,
				expect.objectContaining({
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer test-api-key",
					},
					body: JSON.stringify({
						query: "test query",
						documents: [
							{
								id: "1",
								text: "function test1() {}",
								metadata: {
									filePath: "/test/file1.ts",
									startLine: 1,
									endLine: 3,
									originalScore: 0.8,
								},
							},
							{
								id: "2",
								text: "function test2() {}",
								metadata: {
									filePath: "/test/file2.ts",
									startLine: 5,
									endLine: 7,
									originalScore: 0.6,
								},
							},
						],
					}),
					signal: expect.any(AbortSignal),
				}),
			)

			expect(result.results).toHaveLength(2)
			expect(result.results[0].id).toBe("2")
			expect(result.results[0].score).toBe(0.9)
			expect(result.results[1].id).toBe("1")
			expect(result.results[1].score).toBe(0.7)
		})

		it("should work without API key", async () => {
			const configWithoutKey = { ...config }
			delete configWithoutKey.apiKey
			const rerankerwithoutKey = new HttpReranker(configWithoutKey)

			const mockResponse = {
				documents: [{ id: "1", score: 0.9 }],
			}

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			})

			await rerankerwithoutKey.rerank(mockRequest)

			expect(mockFetch).toHaveBeenCalledWith(
				config.endpoint,
				expect.objectContaining({
					headers: {
						"Content-Type": "application/json",
						// No Authorization header
					},
				}),
			)
		})

		it("should handle HTTP errors", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			})

			await expect(reranker.rerank(mockRequest)).rejects.toThrow(
				"Re-ranking service returned 500: Internal Server Error",
			)
		})

		it("should handle invalid response format", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ invalid: "response" }),
			})

			await expect(reranker.rerank(mockRequest)).rejects.toThrow(
				"Invalid response format from re-ranking service",
			)
		})

		it("should handle unknown document IDs in response", async () => {
			const mockResponse = {
				documents: [{ id: "unknown", score: 0.9 }],
			}

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			})

			await expect(reranker.rerank(mockRequest)).rejects.toThrow(
				"Re-ranking service returned unknown document ID: unknown",
			)
		})

		it("should handle network errors", async () => {
			mockFetch.mockRejectedValueOnce(new Error("Network error"))

			await expect(reranker.rerank(mockRequest)).rejects.toThrow("Re-ranking failed: Network error")
		})

		it("should handle different score field names", async () => {
			const mockResponse = {
				documents: [{ id: "1", relevance_score: 0.95 }],
			}

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			})

			const result = await reranker.rerank(mockRequest)

			expect(result.results[0].score).toBe(0.95)
		})
	})

	describe("isAvailable", () => {
		it("should return true for successful HEAD request", async () => {
			mockFetch.mockResolvedValueOnce({
				status: 200,
			})

			const result = await reranker.isAvailable()

			expect(result).toBe(true)
			expect(mockFetch).toHaveBeenCalledWith(
				config.endpoint,
				expect.objectContaining({
					method: "HEAD",
					signal: expect.any(AbortSignal),
				}),
			)
		})

		it("should return true for 405 Method Not Allowed", async () => {
			mockFetch.mockResolvedValueOnce({
				status: 405,
			})

			const result = await reranker.isAvailable()

			expect(result).toBe(true)
		})

		it("should return false for server errors", async () => {
			mockFetch.mockResolvedValueOnce({
				status: 500,
			})

			const result = await reranker.isAvailable()

			expect(result).toBe(false)
		})

		it("should return false for network errors", async () => {
			mockFetch.mockRejectedValueOnce(new Error("Network error"))

			const result = await reranker.isAvailable()

			expect(result).toBe(false)
		})
	})
})
