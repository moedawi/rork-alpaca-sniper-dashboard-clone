import { supabase } from './supabase';

/**
 * Sends a command to the IBKR bot via Supabase `bot_control` table.
 *
 * Schema (per RORK_BOT_COMMANDS.txt):
 *   bot_control: id INT PK DEFAULT 1, command VARCHAR(50) DEFAULT 'IDLE', updated_at TIMESTAMP
 *
 * Bot polls this row ~every 0.5s, executes the command, then sets it back to 'IDLE'.
 *
 * Valid commands:
 *   - 'HALT'         — stop new entries (manage exits only)
 *   - 'RESUME'       — resume scanning + entries
 *   - 'RESET_VCAP'   — reset virtual capital to $1,000
 *   - 'SELL_{SYM}'   — force-close position (e.g. 'SELL_SKK')
 *
 * IMPORTANT: bot_control has only one slot. If the phone fires multiple
 * commands in quick succession, each one overwrites the last before the
 * bot has a chance to read it. To prevent this we serialize all commands
 * through enqueueBotCommand() — see queue logic below.
 */
export type BotCommand =
  | 'HALT'
  | 'RESUME'
  | 'RESET_VCAP'
  | `SELL_${string}`;

export interface SendCommandResult {
  ok: boolean;
  acked: boolean;
  error?: string;
}

// ─── Module-level serial queue ──────────────────────────────────────────────
// All commands chain through `queueTail`. Each new command waits for the
// previous one to finish (send + wait for ack) before its own send fires.
// JavaScript is single-threaded, so this is enough — no mutex needed.
let queueTail: Promise<void> = Promise.resolve();
let queueDepth = 0;

export function getQueueDepth(): number {
  return queueDepth;
}

/**
 * Enqueue a command. Returns when this command has been sent AND either
 * acked by the bot (command flipped to IDLE) or the ack-wait timed out.
 *
 * Use this everywhere instead of calling sendBotCommandRaw directly.
 */
export async function enqueueBotCommand(command: BotCommand): Promise<SendCommandResult> {
  queueDepth += 1;
  // Chain on the existing tail. We do NOT propagate errors so a single
  // failed command doesn't block the rest of the queue.
  let result: SendCommandResult = { ok: false, acked: false };
  const next = queueTail.then(async () => {
    try {
      const sent = await sendBotCommandRaw(command);
      if (!sent.ok) {
        result = { ok: false, acked: false, error: sent.error };
        return;
      }
      const acked = await waitForAck(8000, 500);
      result = { ok: true, acked };
    } catch (e) {
      result = { ok: false, acked: false, error: (e as Error).message };
    } finally {
      queueDepth = Math.max(0, queueDepth - 1);
    }
  });
  queueTail = next;
  await next;
  return result;
}

/**
 * Low-level: write the command directly to bot_control. Does NOT respect
 * the queue. Exposed for diagnostics / advanced use only.
 */
export async function sendBotCommandRaw(command: BotCommand): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('bot_control')
    .update({ command, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) {
    console.log('[botCommand] error:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Poll bot_control until command flips back to 'IDLE' (bot processed it),
 * or until timeoutMs elapses. Returns true if acked.
 */
export async function waitForAck(timeoutMs: number = 8000, pollMs: number = 500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data, error } = await supabase
      .from('bot_control')
      .select('command')
      .eq('id', 1)
      .single();
    if (!error && data?.command === 'IDLE') return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

/**
 * Read the current bot_control row (so the UI can show e.g. "command pending: HALT").
 */
export async function getCurrentCommand(): Promise<string | null> {
  const { data, error } = await supabase
    .from('bot_control')
    .select('command')
    .eq('id', 1)
    .single();
  if (error || !data) return null;
  return data.command as string;
}
