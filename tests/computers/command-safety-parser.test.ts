import { expect, test } from 'bun:test'
import { checkCommandSafety } from '../../server/computers/command-safety'

const HOME = '/Users/alice'

test('parses input/output redirections, fd duplications, and process substitutions anywhere', () => {
  const blocked = [
    '2>&1 rm -rf /',
    '2>&1 reboot',
    'systemctl 2>&1 reboot',
    'init 2>&1 0',
    'diskutil 2>&1 eraseDisk APFS Test disk2',
    '</dev/null rm -rf /',
    '0</dev/null mkfs.ext4 /dev/sda1',
    '</dev/null reboot',
    'echo x 1>/dev/sda',
    'echo x &>/dev/sda',
    'echo x >&/dev/sda',
    '<> /dev/sda',
    'cat <(rm -rf /)',
    'tee >(reboot)'
  ]
  for (const cmd of blocked) expect(checkCommandSafety(cmd, HOME), cmd).not.toBeNull()
  expect(checkCommandSafety('2>&1 echo ok', HOME)).toBeNull()
  expect(checkCommandSafety('</dev/null ls -la', HOME)).toBeNull()
  expect(checkCommandSafety('echo hi > /dev/null 2>&1', HOME)).toBeNull()
})

test('parses POSIX shell -c option ordering across every shell carrier', () => {
  const blocked = [
    "sh -c -- 'rm -rf /'",
    "sh -c - 'rm -rf /'",
    "bash -c -e 'rm -rf /'",
    "bash -oc pipefail 'rm -rf /'",
    "bash -Oc extglob 'rm -rf /'",
    "bash -co pipefail 'reboot'",
    "bash -e -o pipefail -c -- 'reboot'",
    "bash --rcfile /tmp/x -c 'reboot'",
    "zsh -c 'reboot'",
    "dash -c 'reboot'",
    "ksh -c 'reboot'",
    "ash -c 'reboot'"
  ]
  for (const cmd of blocked) expect(checkCommandSafety(cmd, HOME), cmd).not.toBeNull()
  expect(checkCommandSafety("bash -- -c 'reboot'", HOME)).toBeNull()
  expect(checkCommandSafety('bash -o pipefail script.sh', HOME)).toBeNull()
})

test('handles line continuations, ANSI-C escapes, comments, quotes, and read-tool exec flags', () => {
  const blocked = [
    'printf \\\\\nreboot',
    'true \\\\\nrm -rf /',
    'rm -rf \\\n/',
    'rm -r\\\nf /',
    'rm -rf \\\r\n/',
    "$'\\x72m' -rf /",
    "$'\\u0072m' -rf /",
    "$'\\162m' -rf /",
    `echo "\${HOME}"; rm -rf \${HOME}`,
    "rg --pre 'rm -rf /' foo",
    "rg --pre='reboot' foo",
    "rg --hostname-bin 'reboot' foo",
    "sort --compress-program='reboot' f",
    "ag --pager 'rm -rf /' foo",
    "man -P 'reboot' ls",
    "man -P'reboot' ls",
    "man --pager='rm -rf /' ls",
    "man -H 'reboot' ls",
    "man --html='reboot' ls",
    "grep 'unterminated",
    'echo "unterminated',
    "echo $'unterminated"
  ]
  for (const cmd of blocked) expect(checkCommandSafety(cmd, HOME), cmd).not.toBeNull()
  const allowed = [
    '# rm -rf /; reboot',
    "# don't worry; mkfs /dev/sda",
    'echo ok # ; reboot',
    'rg --pre cat foo',
    "rg -e --pre 'rm -rf /'",
    'sort --compress-program=gzip f',
    'ag --pager less foo',
    'man -P less ls'
  ]
  for (const cmd of allowed) expect(checkCommandSafety(cmd, HOME), cmd).toBeNull()
})

test('handles heredocs as data unless fed to a shell or containing unquoted substitutions', () => {
  const allowed = [
    "cat <<'EOF' > README.md\nrm -rf /\nshutdown -h now\n:(){ :|:& };:\nEOF",
    "git commit -F - <<'EOF'\nfix: shutdown handling\n\nreboot notes\nEOF",
    "cat <<'EOF' > safety.md\ncat f > /dev/sda\nEOF",
    'cat <<-EOF\n\treboot\n\tmkfs /dev/sda\n\tEOF',
    "cat <<'EOF'\n$(rm -rf /)\nit's fine\nEOF"
  ]
  for (const cmd of allowed) expect(checkCommandSafety(cmd, HOME), cmd).toBeNull()
  const blocked = [
    'bash <<EOF\nrm -rf /\nEOF',
    "bash <<'EOF'\nrm -rf /\nEOF",
    'sudo sh <<-EOF\n\treboot\n\tEOF',
    'cat <<EOF\n$(rm -rf /)\nEOF',
    "cat <<'EOF' | bash\nrm -rf /\nEOF",
    "cat <<'EOF' > README.md\nsafe\nEOF\nreboot"
  ]
  for (const cmd of blocked) expect(checkCommandSafety(cmd, HOME), cmd).not.toBeNull()
})

test('unwraps every supported command wrapper and ignores non-system local script paths', () => {
  const wrappers = [
    'sudo -u root rm -rf /',
    'doas -u root reboot',
    'env VAR=1 reboot',
    'env -S "rm -rf /"',
    'exec -a x reboot',
    'nohup mkfs /dev/sdb',
    'setsid poweroff',
    'builtin command reboot',
    'command rm -rf /',
    'time -f %e reboot',
    'nice -n 5 poweroff',
    'timeout 30 shutdown -r now',
    'stdbuf -oL reboot',
    'ionice -c 3 mkfs /dev/sdb',
    'chrt -f 10 reboot',
    'taskset -c 0 reboot',
    'chroot /mnt reboot',
    'echo x | xargs mkfs',
    'busybox reboot',
    '/bin/rm -rf /',
    '/sbin/mkfs.ext4 /dev/sda1',
    '/usr/sbin/reboot',
    '/opt/homebrew/bin/rg --pre reboot foo'
  ]
  for (const cmd of wrappers) expect(checkCommandSafety(cmd, HOME), cmd).not.toBeNull()
  const allowed = [
    'command -v reboot',
    'command -V reboot',
    'ionice -p 1234',
    'chrt -p 1234',
    'taskset -p 1234',
    './bin/reboot',
    './scripts/shutdown',
    'scripts/halt',
    '/Users/alice/project/bin/reboot',
    '/tmp/test/shutdown'
  ]
  for (const cmd of allowed) expect(checkCommandSafety(cmd, HOME), cmd).toBeNull()
})
