import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { runRenderCommand } from "@oh-my-pi/pi-coding-agent/cli/render-cli";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { setAgentDir, setProjectDir, TempDir } from "@oh-my-pi/pi-utils";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "./helpers/settings-test-state";

// `omp render` replays a transcript through InteractiveMode, but it is not a
// top-level interactive session: the Vibe startup default must never apply.
describe("omp render with the Vibe startup default", () => {
	let state: SettingsTestState | undefined;
	let tempDir: TempDir | undefined;

	beforeEach(() => {
		state = beginSettingsTest();
		tempDir = TempDir.createSync("@omp-render-vibe-");
		const agentDir = path.join(tempDir.path(), "agent");
		const projectDir = path.join(tempDir.path(), "project");
		fs.mkdirSync(agentDir, { recursive: true });
		fs.mkdirSync(projectDir, { recursive: true });
		fs.writeFileSync(path.join(agentDir, "config.yml"), "vibe:\n  defaultOnStartup: true\n");
		setAgentDir(agentDir);
		setProjectDir(projectDir);
	});

	afterEach(() => {
		restoreSettingsTestState(state);
		state = undefined;
		tempDir?.removeSync();
		tempDir = undefined;
	});

	async function writeSession(persistedMode?: "vibe"): Promise<string> {
		const projectDir = path.join(tempDir!.path(), "project");
		const sessionManager = SessionManager.create(projectDir, path.join(tempDir!.path(), "sessions"));
		sessionManager.appendMessage({ role: "user", content: "render this transcript", timestamp: Date.now() });
		if (persistedMode) sessionManager.appendModeChange(persistedMode, { previousTools: ["read"] });
		await sessionManager.ensureOnDisk();
		await sessionManager.flush();
		const file = sessionManager.getSessionFile();
		await sessionManager.close();
		if (!file) throw new Error("Expected a persisted session file");
		return file;
	}

	async function render(file: string): Promise<{ exitCode: number; output: string }> {
		const writes: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
			writes.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
			return true;
		}) as typeof process.stdout.write);
		const exitCode = await runRenderCommand({ session: file, plain: true, width: 100, height: 30 });
		return { exitCode, output: writes.join("") };
	}

	it("replays without entering Vibe when vibe.defaultOnStartup is configured", async () => {
		const file = await writeSession();
		const before = fs.readFileSync(file, "utf8");

		const { exitCode, output } = await render(file);

		expect(exitCode).toBe(0);
		expect(output).toContain("render this transcript");
		expect(output).not.toContain("Vibe mode enabled");
		expect(fs.readFileSync(file, "utf8")).toBe(before);
	});

	it("replays a session persisted in Vibe mode without entering Vibe", async () => {
		// Every session the startup default starts is persisted in Vibe; render
		// has no Vibe tool factory, so restoring that mode would reject.
		const file = await writeSession("vibe");
		const before = fs.readFileSync(file, "utf8");

		const { exitCode, output } = await render(file);

		expect(exitCode).toBe(0);
		expect(output).toContain("render this transcript");
		expect(output).not.toContain("Vibe mode enabled");
		expect(fs.readFileSync(file, "utf8")).toBe(before);
	});

	it("replays without entering Vibe under a --vibe runtime override", async () => {
		const file = await writeSession();
		const settings = await Settings.init({ cwd: path.join(tempDir!.path(), "project") });
		settings.override("vibe.defaultOnStartup", true);

		const { exitCode, output } = await render(file);

		expect(exitCode).toBe(0);
		expect(output).toContain("render this transcript");
		expect(output).not.toContain("Vibe mode enabled");
	});
});
