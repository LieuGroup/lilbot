import { expect, test } from 'bun:test'
import { checkCommandSafety } from '../../server/computers/command-safety'

const HOME = '/Users/alice'

test('blocks every protected system directory (Linux and macOS) and allows subpaths', () => {
  const dirs = ['home', 'root', 'etc', 'usr', 'var', 'bin', 'sbin', 'boot', 'lib', 'lib64', 'dev', 'proc', 'sys', 'Users', 'System']
  for (const dir of dirs) {
    expect(checkCommandSafety(`rm -rf /${dir}`, HOME), dir).toContain('system directory')
    expect(checkCommandSafety(`rm -rf /${dir}/*`, HOME), `${dir}/*`).toContain('system directory')
  }
  for (const macDir of ['/private/etc', '/private/var', '/System/Volumes/Data']) {
    expect(checkCommandSafety(`rm -rf ${macDir}`, HOME), macDir).toContain('system directory')
    expect(checkCommandSafety(`rm -rf ${macDir}/*`, HOME), `${macDir}/*`).toContain('system directory')
  }
  expect(checkCommandSafety('rm -rf /private/var/tmp/scratch', HOME)).toBeNull()
  expect(checkCommandSafety('rm -rf /System/Volumes/Data/tmp/x', HOME)).toBeNull()
})

test('blocks every raw block device family and raw-disk tools with benign counterparts', () => {
  for (const dev of ['/dev/sda', '/dev/nvme0n1', '/dev/hda', '/dev/mmcblk0', '/dev/vda', '/dev/xvda', '/dev/rdisk2', '/dev/disk0']) {
    expect(checkCommandSafety(`dd if=/dev/zero of=${dev}`, HOME), dev).toContain('raw block device')
  }
  const blocked: [string, string][] = [
    ['mkfs /dev/sdb', 'mkfs'],
    ['mkfs.ext4 /dev/sda1', 'mkfs'],
    ['newfs /dev/disk2', 'newfs'],
    ['newfs_apfs /dev/disk2', 'newfs'],
    ['diskutil eraseDisk APFS Test disk2', 'diskutil'],
    ['diskutil eraseVolume APFS Test disk2s1', 'diskutil'],
    ['diskutil zeroDisk disk2', 'diskutil'],
    ['diskutil partitionDisk disk2 GPT APFS Test 0b', 'diskutil'],
    ['diskutil secureErase 0 disk2', 'diskutil'],
    ['diskutil apfs deleteContainer disk2', 'diskutil'],
    ['diskutil apfs deleteVolume disk2s1', 'diskutil'],
    ['diskutil apfs eraseVolume disk2s1 -name Test', 'diskutil'],
    ['diskutil coreStorage delete UUID', 'diskutil'],
    ['diskutil cs deleteVolume UUID', 'diskutil'],
    ['echo x | tee /dev/sda', 'raw block device'],
    ['shred -n 1 /dev/sda', 'shred raw block device'],
    ['wipefs -a /dev/nvme0n1', 'wipefs on raw block device'],
    ['truncate -s 0 /dev/sda', 'truncate raw block device'],
    ['cp /dev/zero /dev/sda', 'cp to raw block device'],
    ['cp -t /dev/sda /dev/zero', 'cp to raw block device']
  ]
  for (const [cmd, expected] of blocked) expect(checkCommandSafety(cmd, HOME), cmd).toContain(expected)
  const allowed = [
    'diskutil list',
    'diskutil info disk2',
    'diskutil eject disk2',
    'diskutil unmount disk2s1',
    'echo x | tee /tmp/out.txt',
    'shred /tmp/secret.txt',
    'wipefs /tmp/disk.img',
    'truncate -s 0 /tmp/app.log',
    'cp /dev/zero /tmp/zeros.bin',
    'cp /dev/sda /tmp/image.bak'
  ]
  for (const cmd of allowed) expect(checkCommandSafety(cmd, HOME), cmd).toBeNull()
})

test('blocks host shutdown, reboot, isolate, and kill-all while allowing SIGHUP and normal restarts', () => {
  const blocked: [string, string][] = [
    ['shutdown -h now', 'shutdown/reboot'],
    ['reboot', 'shutdown/reboot'],
    ['halt', 'shutdown/reboot'],
    ['poweroff', 'shutdown/reboot'],
    ['init 0', 'init 0/6'],
    ['init 6', 'init 0/6'],
    ['telinit 0', 'telinit 0/6'],
    ['telinit 6', 'telinit 0/6'],
    ['systemctl poweroff', 'systemctl'],
    ['systemctl reboot', 'systemctl'],
    ['systemctl halt', 'systemctl'],
    ['systemctl kexec', 'systemctl'],
    ['systemctl -H host halt', 'systemctl'],
    ['systemctl isolate poweroff.target', 'systemctl'],
    ['systemctl isolate reboot.target', 'systemctl'],
    ['systemctl isolate halt', 'systemctl'],
    ['systemctl isolate runlevel0.target', 'systemctl'],
    ['systemctl isolate runlevel6.target', 'systemctl'],
    ['launchctl reboot', 'launchctl reboot'],
    ['kill -1', 'kill all processes'],
    ['kill -9 -1', 'kill all processes'],
    ['kill -- -1', 'kill all processes'],
    ['kill -s TERM -1', 'kill all processes'],
    ['kill --signal=KILL -1', 'kill all processes'],
    ['kill -1 -1', 'kill all processes'],
    ['kill -1 12345 -1', 'kill all processes']
  ]
  for (const [cmd, expected] of blocked) expect(checkCommandSafety(cmd, HOME), cmd).toContain(expected)
  const allowed = [
    'kill -1 12345',
    'kill -1 $$',
    'kill -1 -12345',
    'kill -s 1 12345',
    'kill -l',
    'kill -l -1',
    'kill -9 12345',
    'systemctl status lilbot',
    'systemctl isolate multi-user.target',
    'systemctl status poweroff.target',
    'launchctl list',
    'launchctl kickstart -k gui/501/com.example',
    'xcrun simctl shutdown booted',
    'adb reboot'
  ]
  for (const cmd of allowed) expect(checkCommandSafety(cmd, HOME), cmd).toBeNull()
})
