import { describe, expect, it } from "bun:test";
import { parseArgs } from "@oh-my-pi/pi-coding-agent/cli/args";
import { extractProfileFlags } from "@oh-my-pi/pi-coding-agent/cli/profile-bootstrap";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { runRootCommand } from "@oh-my-pi/pi-coding-agent/main";
import type { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { getProjectDir, setProjectDir, TempDir } from "@oh-my-pi/pi-utils";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

describe("Vibe startup CLI overrides", () => {
	it.each([
		{ flags: ["--vibe", "--no-vibe"], expected: false },
		{ flags: ["--no-vibe", "--vibe"], expected: true },
	])("uses the last override without consuming the profile or prompt: $flags", ({ flags, expected }) => {
		const extracted = extractProfileFlags([...flags, "--profile", "work", "inspect the change"]);
		const parsed = parseArgs(extracted.argv);
		expect(extracted.profile).toBe("work");
		expect(parsed.vibe).toBe(expected);
		expect(parsed.messages).toEqual(["inspect the change"]);
		expect(parsed.unrecognizedFlags).toEqual([]);
	});

	it.each([
		{ configured: true, flag: "--no-vibe", expected: false },
		{ configured: false, flag: "--vibe", expected: true },
	])("applies $flag over resolved configuration before session creation", async ({ configured, flag, expected }) => {
		using tempDir = TempDir.createSync("@omp-cli-vibe-");
		const originalProject = getProjectDir();
		const settings = Settings.isolated({
			"vibe.defaultOnStartup": configured,
			"marketplace.autoUpdate": "off",
		});
		const authStorage = createInMemoryAuthStorage();
		const rawArgs = [
			"--cwd",
			tempDir.path(),
			"--print",
			"--no-extensions",
			"--no-skills",
			"--no-rules",
			"--no-tools",
			"--no-lsp",
			flag,
		];
		const stop = new Error("stop before session startup");
		let manager: SessionManager | undefined;
		try {
			await expect(
				runRootCommand(parseArgs(rawArgs), rawArgs, {
					settings,
					discoverAuthStorage: async () => authStorage,
					createAgentSession: async options => {
						manager = options?.sessionManager;
						expect(settings.get("vibe.defaultOnStartup")).toBe(expected);
						throw stop;
					},
				}),
			).rejects.toBe(stop);
		} finally {
			await manager?.close();
			authStorage.close();
			setProjectDir(originalProject);
		}
	});
});
