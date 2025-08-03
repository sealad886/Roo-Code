import { crashReportService } from "./crash-report-service"

/**
 * Wraps a function with error handling and reporting.
 * @param fn The function to wrap
 * @param location A string identifying the location of the function for error reporting
 * @returns The wrapped function
 */
export function withErrorHandling<T extends (...args: any[]) => any>(
	fn: T,
	location: string,
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
	return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
		try {
			return await fn(...args)
		} catch (error) {
			crashReportService.reportError(error, location)
			throw error
		}
	}
}
