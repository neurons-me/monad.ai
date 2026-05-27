#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { deleteMonadProcess, followMonadLogs, getMonadStatus, listMonadRecords, listRunningMonads, normalizeMonadName, pauseMonadProcess, readLogTail, readMonadRecord, restartMonadProcess, resumeMonadProcess, startMonadProcess, startMonadProxy, stopMonadProcess, } from "./runtime.js";
function printHelp() {
    console.log(`monads

Usage:
  monads                     Open the Monad control panel
  monads list                List known monads
  monads start [name]        Start a new Monad. Auto-names when name is omitted
  monads start [name] --dev  Hot-reload mode: watches source .ts files via tsx
  monads on [name]           Turn on a known Monad, or start one when omitted
  monads pause <name>        Pause a Monad without forgetting it
  monads resume <name>       Resume a paused or stopped Monad
  monads off <name>          Alias for stop
  monads stop <name>         Stop a running Monad
  monads restart <name>      Restart a Monad
  monads delete <name>       Delete a Monad and its local runtime data
  monads rm <name>           Alias for delete
  monads status [name]       Show status for one Monad or all known Monads
  monads logs <name>         Stream Monad logs in real time
  monads logs <name> --tail  Show recent Monad logs without following
  monads proxy               Start the .monad browser gateway (routes name.monad)
  monads proxy --port <port> Start the gateway on a custom port (default: 8160)

Options:
  --port <port>              Request a specific port
  --namespace <rootspace>    Rootspace/host namespace. Port is never part of it
  --rootspace <rootspace>    Alias for --namespace
  --dev                      Hot-reload mode (tsx watch). Saves in record; restart inherits it
`);
}
function parseOptionValue(args, name) {
    const index = args.indexOf(name);
    if (index < 0)
        return undefined;
    return args[index + 1];
}
function parseNamespaceOption(args) {
    return parseOptionValue(args, "--namespace") || parseOptionValue(args, "--rootspace");
}
function parsePositionalName(args) {
    const valueOptions = new Set(["--port", "--namespace", "--rootspace"]);
    for (let index = 1; index < args.length; index += 1) {
        const arg = args[index];
        const previous = args[index - 1];
        if (arg.startsWith("--"))
            continue;
        if (valueOptions.has(previous))
            continue;
        return arg;
    }
    return undefined;
}
function formatStatus(status) {
    const mark = status.status === "running" ? "online" : status.status;
    const devTag = status.record.dev ? " [dev]" : "";
    const detail = status.error ? `  (${status.error})` : "";
    return `${status.record.name.padEnd(18)} ${String(status.record.port).padEnd(6)} ${mark.padEnd(9)} ${status.record.namespace}${devTag}${detail}`;
}
async function printRecords(onlyRunning = false) {
    const statuses = onlyRunning
        ? await listRunningMonads()
        : await Promise.all((await listMonadRecords()).map(getMonadStatus));
    if (statuses.length === 0) {
        console.log(onlyRunning ? "No running monads." : "No monads have been started yet.");
        return;
    }
    console.log("name               port   status    namespace");
    console.log("------------------------------------------------");
    for (const status of statuses)
        console.log(formatStatus(status));
}
async function commandStart(args) {
    const portValue = parseOptionValue(args, "--port");
    const namespace = parseNamespaceOption(args);
    const name = parsePositionalName(args);
    const dev = args.includes("--dev");
    const status = await startMonadProcess({
        name,
        port: portValue ? Number(portValue) : undefined,
        namespace,
        dev,
    });
    console.log(`Started ${status.record.name}${status.record.dev ? " [dev]" : ""}`);
    console.log(`  namespace:${status.record.namespace}`);
    console.log(`  surface:  ${status.record.surface}`);
    console.log(`  endpoint: ${status.record.endpoint}`);
    console.log(`  pid:      ${status.record.pid}`);
    console.log(`  status:   ${status.status}${status.record.dev ? "  (tsx watch — hot reload)" : ""}`);
}
async function commandStop(args) {
    const name = args[1];
    if (!name)
        throw new Error("Usage: monads stop <name>");
    const status = await stopMonadProcess(name);
    console.log(`Stopped ${status.record.name}`);
}
async function commandPause(args) {
    const name = args[1];
    if (!name)
        throw new Error("Usage: monads pause <name>");
    const status = await pauseMonadProcess(name);
    console.log(`Paused ${status.record.name}`);
}
async function commandResume(args) {
    const name = args[1];
    if (!name)
        throw new Error("Usage: monads resume <name>");
    const portValue = parseOptionValue(args, "--port");
    const namespace = parseNamespaceOption(args);
    const status = await resumeMonadProcess(name, {
        port: portValue ? Number(portValue) : undefined,
        namespace,
    });
    console.log(`Resumed ${status.record.name} on ${status.record.endpoint}`);
}
async function commandOn(args) {
    const name = parsePositionalName(args);
    if (!name) {
        await commandStart(args);
        return;
    }
    const existing = await readMonadRecord(name);
    if (!existing) {
        await commandStart(args);
        return;
    }
    await commandResume(["resume", name, ...args.slice(2)]);
}
async function commandOff(args) {
    const name = args[1];
    if (!name)
        throw new Error("Usage: monads off <name>");
    await commandStop(["stop", name]);
}
async function commandRestart(args) {
    const name = args[1];
    if (!name)
        throw new Error("Usage: monads restart <name>");
    const namespace = parseNamespaceOption(args);
    const portValue = parseOptionValue(args, "--port");
    const status = await restartMonadProcess(name, {
        port: portValue ? Number(portValue) : undefined,
        namespace,
    });
    console.log(`Restarted ${status.record.name} on ${status.record.endpoint}`);
}
async function commandDelete(args) {
    const name = args[1];
    if (!name)
        throw new Error("Usage: monads delete <name>");
    const result = await deleteMonadProcess(name);
    console.log(`Deleted ${result.record.name}`);
    console.log(`  removed: ${result.runtimeDir}`);
}
async function commandStatus(args) {
    const name = args[1];
    if (!name) {
        await printRecords(false);
        return;
    }
    const record = await readMonadRecord(name);
    if (!record)
        throw new Error(`Monad "${normalizeMonadName(name)}" was not found.`);
    const status = await getMonadStatus(record);
    console.log(formatStatus(status));
    console.log(`namespace:${status.record.namespace}`);
    console.log(`surface:  ${status.record.surface}`);
    console.log(`endpoint: ${status.record.endpoint}`);
    console.log(`pid:      ${status.record.pid}`);
    console.log(`logs:     ${status.record.stdoutLog}`);
}
async function commandLogs(args) {
    const name = args[1];
    if (!name)
        throw new Error("Usage: monads logs <name>");
    const record = await readMonadRecord(name);
    if (!record)
        throw new Error(`Monad "${normalizeMonadName(name)}" was not found.`);
    const snapshotOnly = args.includes("--tail") || args.includes("--no-follow");
    if (snapshotOnly) {
        const stdout = await readLogTail(record, "stdout");
        const stderr = await readLogTail(record, "stderr");
        console.log(`stdout: ${record.stdoutLog}`);
        console.log(stdout || "(empty)");
        if (stderr) {
            console.log(`\nstderr: ${record.stderrLog}`);
            console.log(stderr);
        }
        return;
    }
    console.log(`Streaming ${record.name} logs`);
    console.log(`  stdout: ${record.stdoutLog}`);
    console.log(`  stderr: ${record.stderrLog}`);
    console.log("Press Ctrl+C to stop.\n");
    const controller = new AbortController();
    const stop = () => {
        controller.abort();
        process.stdout.write("\nStopped log stream.\n");
    };
    process.once("SIGINT", stop);
    await followMonadLogs(record, { signal: controller.signal });
    process.removeListener("SIGINT", stop);
}
async function commandProxy(args) {
    const portValue = parseOptionValue(args, "--port");
    await startMonadProxy({ port: portValue ? Number(portValue) : undefined });
}
async function ask(rl, question) {
    return (await rl.question(question)).trim();
}
async function startFromPanel(rl) {
    const rawName = await ask(rl, "Monad name (blank = auto): ");
    const rawPort = await ask(rl, "Port (blank = auto): ");
    const status = await startMonadProcess({
        name: rawName || undefined,
        port: rawPort ? Number(rawPort) : undefined,
    });
    console.log(`\nStarted ${status.record.name} in ${status.record.namespace} at ${status.record.endpoint}\n`);
}
async function chooseKnownMonad(rl, action) {
    const needsRunning = action === "pause" || action === "stop";
    const statuses = needsRunning
        ? await listRunningMonads()
        : await Promise.all((await listMonadRecords()).map(getMonadStatus));
    if (statuses.length === 0) {
        console.log(needsRunning ? "No running monads.\n" : "No monads have been started yet.\n");
        return;
    }
    statuses.forEach((status, index) => {
        const label = status.status === "running" ? "online" : status.status;
        console.log(`${index + 1}. ${status.record.name} (${status.record.endpoint}) ${label}`);
    });
    const selected = Number(await ask(rl, `${action} which Monad? `));
    const record = statuses[selected - 1]?.record;
    if (!record) {
        console.log("Invalid selection.\n");
        return;
    }
    if (action === "resume")
        await commandResume(["resume", record.name]);
    if (action === "pause")
        await commandPause(["pause", record.name]);
    if (action === "stop")
        await commandStop(["stop", record.name]);
    if (action === "restart")
        await commandRestart(["restart", record.name]);
    if (action === "delete") {
        const answer = await ask(rl, `Delete ${record.name} and its local runtime data? Type delete to confirm: `);
        if (answer !== "delete") {
            console.log("Delete cancelled.\n");
            return;
        }
        await commandDelete(["delete", record.name]);
    }
    if (action === "logs") {
        console.clear();
        console.log(`Streaming ${record.name} logs`);
        console.log(`  stdout: ${record.stdoutLog}`);
        console.log(`  stderr: ${record.stderrLog}`);
        console.log("Press Enter to return to the panel.\n");
        const controller = new AbortController();
        const stream = followMonadLogs(record, { signal: controller.signal });
        await rl.question("");
        controller.abort();
        await stream;
    }
    if (action === "status")
        await commandStatus(["status", record.name]);
    console.log("");
}
async function openPanel() {
    const rl = createInterface({ input, output });
    try {
        while (true) {
            console.clear();
            console.log("Monads Control Panel\n");
            await printRecords(true);
            console.log("\n1. Start a New Monad");
            console.log("2. View All Monads");
            console.log("3. On / Resume a Monad");
            console.log("4. Pause a Monad");
            console.log("5. Off / Stop a Monad");
            console.log("6. Restart a Monad");
            console.log("7. Delete a Monad");
            console.log("8. View Monad Logs");
            console.log("9. View Monad Status");
            console.log("0. Exit");
            const choice = await ask(rl, "\nChoose an option: ");
            console.log("");
            if (choice === "0")
                break;
            if (choice === "1")
                await startFromPanel(rl);
            else if (choice === "2") {
                await printRecords(false);
                console.log("");
            }
            else if (choice === "3")
                await chooseKnownMonad(rl, "resume");
            else if (choice === "4")
                await chooseKnownMonad(rl, "pause");
            else if (choice === "5")
                await chooseKnownMonad(rl, "stop");
            else if (choice === "6")
                await chooseKnownMonad(rl, "restart");
            else if (choice === "7")
                await chooseKnownMonad(rl, "delete");
            else if (choice === "8") {
                await chooseKnownMonad(rl, "logs");
                continue;
            }
            else if (choice === "9")
                await chooseKnownMonad(rl, "status");
            else
                console.log("Unknown option.\n");
            await ask(rl, "Press Enter to continue...");
        }
    }
    finally {
        rl.close();
    }
}
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    if (!command) {
        await openPanel();
        return;
    }
    if (command === "help" || command === "--help" || command === "-h")
        printHelp();
    else if (command === "list" || command === "ls")
        await printRecords(false);
    else if (command === "start")
        await commandStart(args);
    else if (command === "on")
        await commandOn(args);
    else if (command === "pause")
        await commandPause(args);
    else if (command === "resume")
        await commandResume(args);
    else if (command === "off")
        await commandOff(args);
    else if (command === "stop")
        await commandStop(args);
    else if (command === "restart")
        await commandRestart(args);
    else if (command === "delete" || command === "rm")
        await commandDelete(args);
    else if (command === "status")
        await commandStatus(args);
    else if (command === "logs")
        await commandLogs(args);
    else if (command === "proxy")
        await commandProxy(args);
    else {
        printHelp();
        process.exitCode = 1;
    }
}
main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
});
