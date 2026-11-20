/** What to run on a machine without a screen. The code goes in on stdin, never in the process list.
 *  `helperUrl` is the helper door origin the server reports (`LILBOT_HELPER_URL`). */
export const installCommand = (code: string, helperUrl: string) => `printf '%s' '${code}' | ./lilbot-helper install ${helperUrl}`
