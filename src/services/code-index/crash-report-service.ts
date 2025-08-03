import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"
import { sanitizeErrorMessage } from "./shared/validation-helpers"

/**
 * Service responsible for collecting and reporting crash diagnostics.
 */
export class CrashReportService {
	/**
	 * Captures an error, gathers context, and sends a crash report.
	 * @param error The error to report
	 * @param location The location in the code where the error occurred
	 * @param additionalContext Optional additional context to include in the report
	 */
	public reportError(error: any, location: string, additionalContext?: Record<string, any>): void {
		const errorMessage = error instanceof Error ? error.message : String(error)
		const stack = error instanceof Error ? error.stack : undefined

		console.error(`[CrashReportService] Error at ${location}:`, errorMessage, { error, additionalContext })

		TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
			error: sanitizeErrorMessage(errorMessage),
			stack: stack ? sanitizeErrorMessage(stack) : undefined,
			location,
			...additionalContext,
		})
	}
}

export const crashReportService = new CrashReportService()
