import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { CodeIndexSearchService } from "../search-service"
import { CodeIndexConfigManager } from "../config-manager"
import { CodeIndexStateManager } from "../state-manager"
import { IEmbedder } from "../interfaces/embedder"
import { IVectorStore } from "../interfaces/vector-store"
import { IReranker } from "../interfaces/reranker"
import { VectorStoreSearchResult } from "../interfaces/vector-store"

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

// Mock dependencies
const mockConfigManager = {
	isFeatureEnabled: true,
	isFeatureConfigured: true,
	currentSearchMinScore: 0.4,
	currentSearchMaxResults: 50,
} as CodeIndexConfigManager

const mockStateManager = {
	getCurrentStatus: vi.fn(() => ({
		systemStatus: "Indexed",
		message: "",
		processedItems: 0,
		totalItems: 0,
		currentItemUnit: "items",
	})),
	setSystemState: vi.fn(),
} as unknown as CodeIndexStateManager

const mockEmbedder = {
	createEmbeddings: vi.fn(),
} as unknown as IEmbedder

const mockVectorStore = {
	search: vi.fn(),
} as unknown as IVectorStore

const mockReranker = {
	rerank: vi.fn(),
} as unknown as IReranker

describe("CodeIndexSearchService", () => {
	let searchService: CodeIndexSearchService
	let searchServiceWithReranker: CodeIndexSearchService

	beforeEach(() => {
		searchService = new CodeIndexSearchService(mockConfigManager, mockStateManager, mockEmbedder, mockVectorStore)

		searchServiceWithReranker = new CodeIndexSearchService(
			mockConfigManager,
			mockStateManager,
			mockEmbedder,
			mockVectorStore,
			mockReranker,
		)

		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("searchIndex", () => {
		const mockQuery = "test search query"
		const mockVector = [0.1, 0.2, 0.3]
		const mockResults: VectorStoreSearchResult[] = [
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
		]

		beforeEach(() => {
			vi.mocked(mockEmbedder.createEmbeddings).mockResolvedValue({
				embeddings: [mockVector],
			})
			vi.mocked(mockVectorStore.search).mockResolvedValue(mockResults)
		})

		it("should perform basic search without reranking", async () => {
			const results = await searchService.searchIndex(mockQuery)

			expect(mockEmbedder.createEmbeddings).toHaveBeenCalledWith([mockQuery])
			expect(mockVectorStore.search).toHaveBeenCalledWith(mockVector, undefined, 0.4, 50)
			expect(results).toEqual(mockResults)
		})

		it("should perform search with directory prefix", async () => {
			const directoryPrefix = "/test"
			await searchService.searchIndex(mockQuery, directoryPrefix)

			expect(mockVectorStore.search).toHaveBeenCalledWith(
				mockVector,
				"/test", // normalized path
				0.4,
				50,
			)
		})

		it("should apply reranking when reranker is available", async () => {
			const rerankedResults: VectorStoreSearchResult[] = [
				{ ...mockResults[1], score: 0.9 }, // file2 ranked higher
				{ ...mockResults[0], score: 0.7 }, // file1 ranked lower
			]

			vi.mocked(mockReranker.rerank).mockResolvedValue({
				results: rerankedResults,
			})

			const results = await searchServiceWithReranker.searchIndex(mockQuery)

			expect(mockReranker.rerank).toHaveBeenCalledWith({
				query: mockQuery,
				results: mockResults,
			})
			expect(results).toEqual(rerankedResults)
		})

		it("should fallback to original results if reranking fails", async () => {
			vi.mocked(mockReranker.rerank).mockRejectedValue(new Error("Reranking service error"))

			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

			const results = await searchServiceWithReranker.searchIndex(mockQuery)

			expect(consoleSpy).toHaveBeenCalledWith(
				"[CodeIndexSearchService] Re-ranking failed, using original results:",
				expect.any(Error),
			)
			expect(results).toEqual(mockResults) // Should return original results
		})

		it("should skip reranking if no results", async () => {
			vi.mocked(mockVectorStore.search).mockResolvedValue([])

			const results = await searchServiceWithReranker.searchIndex(mockQuery)

			expect(mockReranker.rerank).not.toHaveBeenCalled()
			expect(results).toEqual([])
		})

		it("should cap results sent to reranker by both embedder and reranker settings (embedder smaller)", async () => {
			// Create 20 results
			const manyResults: VectorStoreSearchResult[] = Array.from({ length: 20 }).map((_, i) => ({
				id: `${i + 1}`,
				score: 1 - i * 0.01,
				payload: { filePath: `/file${i + 1}.ts`, codeChunk: `c${i + 1}`, startLine: 1, endLine: 1 },
			}))

			vi.mocked(mockVectorStore.search).mockResolvedValue(manyResults)
			vi.mocked(mockEmbedder.createEmbeddings).mockResolvedValue({ embeddings: [mockVector] })

			const cfg = {
				...mockConfigManager,
				currentSearchMaxResults: 10, // embedder cap
				rerankingMaxResults: 5, // reranker cap
			} as unknown as CodeIndexConfigManager

			const svc = new CodeIndexSearchService(cfg, mockStateManager, mockEmbedder, mockVectorStore, mockReranker)

			vi.mocked(mockReranker.rerank).mockResolvedValue({ results: manyResults.slice(0, 5) })

			await svc.searchIndex(mockQuery)

			// Expect reranker called with 5 results (min(embedder 10, reranker 5) => 5)
			expect(mockReranker.rerank).toHaveBeenCalledWith({
				query: mockQuery,
				results: manyResults.slice(0, 5),
			})
		})

		it("should cap results sent to reranker by embedder when reranker requests more", async () => {
			const manyResults: VectorStoreSearchResult[] = Array.from({ length: 20 }).map((_, i) => ({
				id: `${i + 1}`,
				score: 1 - i * 0.01,
				payload: { filePath: `/file${i + 1}.ts`, codeChunk: `c${i + 1}`, startLine: 1, endLine: 1 },
			}))

			vi.mocked(mockVectorStore.search).mockResolvedValue(manyResults)
			vi.mocked(mockEmbedder.createEmbeddings).mockResolvedValue({ embeddings: [mockVector] })

			const cfg = {
				...mockConfigManager,
				currentSearchMaxResults: 8, // embedder cap
				rerankingMaxResults: 20, // reranker requests more than embedder
			} as unknown as CodeIndexConfigManager

			const svc = new CodeIndexSearchService(cfg, mockStateManager, mockEmbedder, mockVectorStore, mockReranker)

			vi.mocked(mockReranker.rerank).mockResolvedValue({ results: manyResults.slice(0, 8) })

			await svc.searchIndex(mockQuery)

			// Expect reranker called with 8 results (capped to embedder)
			expect(mockReranker.rerank).toHaveBeenCalledWith({
				query: mockQuery,
				results: manyResults.slice(0, 8),
			})
		})

		it("should limit results to reranker setting when embedder has no cap", async () => {
			const manyResults: VectorStoreSearchResult[] = Array.from({ length: 20 }).map((_, i) => ({
				id: `${i + 1}`,
				score: 1 - i * 0.01,
				payload: { filePath: `/file${i + 1}.ts`, codeChunk: `c${i + 1}`, startLine: 1, endLine: 1 },
			}))

			vi.mocked(mockVectorStore.search).mockResolvedValue(manyResults)
			vi.mocked(mockEmbedder.createEmbeddings).mockResolvedValue({ embeddings: [mockVector] })

			const cfg = {
				...mockConfigManager,
				// no embedder cap provided (undefined), only reranker cap
				currentSearchMaxResults: undefined as unknown as number,
				rerankingMaxResults: 3,
			} as unknown as CodeIndexConfigManager

			const svc = new CodeIndexSearchService(cfg, mockStateManager, mockEmbedder, mockVectorStore, mockReranker)

			vi.mocked(mockReranker.rerank).mockResolvedValue({ results: manyResults.slice(0, 3) })

			await svc.searchIndex(mockQuery)

			expect(mockReranker.rerank).toHaveBeenCalledWith({
				query: mockQuery,
				results: manyResults.slice(0, 3),
			})
		})

		it("should throw error when feature is disabled", async () => {
			const disabledConfigManager = {
				...mockConfigManager,
				isFeatureEnabled: false,
			} as CodeIndexConfigManager

			const disabledSearchService = new CodeIndexSearchService(
				disabledConfigManager,
				mockStateManager,
				mockEmbedder,
				mockVectorStore,
			)

			await expect(disabledSearchService.searchIndex(mockQuery)).rejects.toThrow(
				"Code index feature is disabled or not configured.",
			)
		})

		it("should throw error when feature is not configured", async () => {
			const unconfiguredConfigManager = {
				...mockConfigManager,
				isFeatureConfigured: false,
			} as CodeIndexConfigManager

			const unconfiguredSearchService = new CodeIndexSearchService(
				unconfiguredConfigManager,
				mockStateManager,
				mockEmbedder,
				mockVectorStore,
			)

			await expect(unconfiguredSearchService.searchIndex(mockQuery)).rejects.toThrow(
				"Code index feature is disabled or not configured.",
			)
		})

		it("should throw error when system is not ready", async () => {
			vi.mocked(mockStateManager.getCurrentStatus).mockReturnValue({
				systemStatus: "Error" as any,
				message: "",
				processedItems: 0,
				totalItems: 0,
				currentItemUnit: "items",
			})

			await expect(searchService.searchIndex(mockQuery)).rejects.toThrow(
				"Code index is not ready for search. Current state: Error",
			)
		})

		it("should allow search during indexing", async () => {
			vi.mocked(mockStateManager.getCurrentStatus).mockReturnValue({
				systemStatus: "Indexing" as any,
				message: "",
				processedItems: 0,
				totalItems: 0,
				currentItemUnit: "items",
			})

			const results = await searchService.searchIndex(mockQuery)

			expect(results).toEqual(mockResults)
		})

		it("should throw error when embedding generation fails", async () => {
			vi.mocked(mockEmbedder.createEmbeddings).mockResolvedValue({
				embeddings: [],
			})

			await expect(searchService.searchIndex(mockQuery)).rejects.toThrow(
				"Failed to generate embedding for query.",
			)
		})

		it("should set error state and rethrow on search failure", async () => {
			const searchError = new Error("Vector search failed")
			vi.mocked(mockVectorStore.search).mockRejectedValue(searchError)

			await expect(searchService.searchIndex(mockQuery)).rejects.toThrow(searchError)

			expect(mockStateManager.setSystemState).toHaveBeenCalledWith("Error", "Search failed: Vector search failed")
		})
	})
})
