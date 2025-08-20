#!/usr/bin/env node
import path from "path"
import fs from "fs"
import { safeWriteJson } from "../src/utils/safeWriteJson"

const locales = ["ca", "de", "es", "fr", "hi", "id", "it", "ja", "ko", "nl", "pl", "pt-BR", "ru", "tr", "vi"]

async function run() {
	for (const loc of locales) {
		const filePath = path.resolve(process.cwd(), "webview-ui", "src", "i18n", "locales", loc, "settings.json")
		if (!fs.existsSync(filePath)) {
			console.warn(`Skipping missing: ${filePath}`)
			continue
		}
		const raw = fs.readFileSync(filePath, "utf8")
		let data
		try {
			data = JSON.parse(raw)
		} catch (e) {
			console.error(`Invalid JSON ${filePath}:`, e)
			continue
		}
		await safeWriteJson(filePath, data)
		console.log(`Rewrote ${filePath}`)
	}
}

run().catch((err) => {
	console.error(err)
	process.exit(1)
})
