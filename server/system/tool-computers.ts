/** Computer tools on LilBot's own MCP server: list added computers, run commands, read/write/list files, manage requests and copy to/from the bot's workspace. */
import { ZodError, z } from 'zod'
import { ComputerCopy, ComputerRequestRef } from '../../shared/computer-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { actionTool, type McpTool, readTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

const RETRY_NOTE = ' Reuse requestId only on retry; background queues even offline, else offline fails.'
const fsError = (error: unknown) => error instanceof Error && /^E[A-Z]+$/.test(String((error as { code?: unknown }).code))

async function runComputer<T>(step: () => T | Promise<T>): Promise<T> {
  try {
    return await step()
  } catch (error) {
    if (error instanceof LilBotError || error instanceof ZodError) throw error
    if (fsError(error)) throw new LilBotError('computer_copy_failed', 'Cannot access workspace file. Use a regular file inside your workspace whose parent folder exists.')
    if (error instanceof Error) throw new LilBotError('computer_refused', error.message)
    throw error
  }
}

const CommonSubmit = {
  computer: z.string().min(1),
  requestId: z.string().min(1).max(100).optional(),
  background: z.boolean().optional()
}

export function computerTools({ computers }: SystemDeps): McpTool[] {
  return [
    readTool('lilbot_computers_list', 'List computers, capabilities and online state. Use exact computer id in other calls.', z.object({}), async () => computers.list()),
    actionTool(
      'lilbot_computer_exec',
      `Run a shell command on a computer.${RETRY_NOTE}`,
      z.object({
        ...CommonSubmit,
        command: z.string().min(1).max(100_000),
        cwd: z.string().max(4096).optional(),
        timeoutMs: z.number().int().min(1).max(3_600_000).optional()
      }),
      (caller, { computer, requestId, background, command, cwd, timeoutMs }) =>
        runComputer(() =>
          computers.submit(caller, {
            computer,
            requestId: requestId ?? crypto.randomUUID(),
            background: background ?? false,
            operation: { kind: 'exec', command, ...(cwd !== undefined ? { cwd } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) }
          })
        )
    ),
    actionTool(
      'lilbot_computer_read_file',
      `Read a file on a computer (returns base64).${RETRY_NOTE}`,
      z.object({ ...CommonSubmit, path: z.string().min(1).max(4096) }),
      (caller, { computer, requestId, background, path }) =>
        runComputer(() => computers.submit(caller, { computer, requestId: requestId ?? crypto.randomUUID(), background: background ?? false, operation: { kind: 'read', path } }))
    ),
    actionTool(
      'lilbot_computer_write_file',
      `Write a file on a computer.${RETRY_NOTE}`,
      z.object({
        ...CommonSubmit,
        path: z.string().min(1).max(4096),
        data: z.string().max(5_600_000),
        encoding: z.enum(['utf8', 'base64']).optional()
      }),
      (caller, { computer, requestId, background, path, data, encoding }) =>
        runComputer(() =>
          computers.submit(caller, {
            computer,
            requestId: requestId ?? crypto.randomUUID(),
            background: background ?? false,
            operation: { kind: 'write', path, data, ...(encoding !== undefined ? { encoding } : {}) }
          })
        )
    ),
    actionTool(
      'lilbot_computer_list_folder',
      `List a folder on a computer.${RETRY_NOTE}`,
      z.object({ ...CommonSubmit, path: z.string().min(1).max(4096) }),
      (caller, { computer, requestId, background, path }) =>
        runComputer(() => computers.submit(caller, { computer, requestId: requestId ?? crypto.randomUUID(), background: background ?? false, operation: { kind: 'list', path } }))
    ),
    readTool('lilbot_computer_request_read', 'Read status and output of a computer request. Does not wait.', ComputerRequestRef, (caller, input) =>
      runComputer(() => computers.read(caller, input))
    ),
    actionTool('lilbot_computer_cancel', 'Cancel a pending or running computer request.', ComputerRequestRef, (caller, input) =>
      runComputer(() => computers.cancel(caller, input))
    ),
    actionTool(
      'lilbot_computer_copy',
      'Copy a file (<=4 MiB) between a computer and workspace. workspacePath is relative; parent must exist. Reuse requestId on retry.',
      ComputerCopy,
      (caller, input) => runComputer(() => computers.copy(caller, input))
    )
  ]
}
