"""Assemble genuine linked runtime libraries, preserving their Debian package metadata.

No dpkg/SBOM record is hidden for a copied library. Interactive terminal extensions
and libuuid acceleration are not inference features; uuid retains its stdlib fallback.
"""
import re
import shutil
import subprocess
from pathlib import Path

root = Path('/runtime-additions')
root.mkdir()
python = Path('/usr/local')
for pattern in ('readline*.so', '_curses*.so', '_uuid*.so', '_tkinter*.so'):
    for extension in python.glob(f'lib/python*/lib-dynload/{pattern}'):
        extension.unlink()
targets = [Path('/usr/local/bin/python3.12')]
targets += list(python.rglob('*.so')) + list(python.rglob('*.so.*'))
targets += list(Path('/service/.venv').rglob('*.so')) + list(Path('/service/.venv').rglob('*.so.*'))
libraries = set()
for target in targets:
    result = subprocess.run(['ldd', str(target)], capture_output=True, text=True, check=False)
    if result.returncode and 'not a dynamic executable' not in result.stderr and 'statically linked' not in result.stdout:
        raise RuntimeError(f'Unable to inspect native dependency: {target.name}')
    if 'not found' in result.stdout:
        raise RuntimeError(f'Missing native dependency: {target.name}')
    libraries.update(re.findall(r'(?:=>\s+|^\s*)(/[^\s]+)', result.stdout, re.MULTILINE))
packages = set()
for source in sorted(libraries):
    if source.startswith(('/usr/local/', '/service/')):
        continue
    actual = Path(source).resolve(strict=True)
    if not str(actual).startswith('/usr/lib/'):
        raise RuntimeError('Unexpected system library location')
    destination = root / actual.parent.relative_to('/') / Path(source).name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(actual, destination)
    owner = None
    for candidate in (source, str(actual)):
        result = subprocess.run(['dpkg-query', '-S', candidate], capture_output=True, text=True, check=False)
        if result.returncode == 0:
            # dpkg prints diversion notices before ownership rows for the ELF loader.
            # Accept only genuine package-name records, never those human-readable notices.
            for line in result.stdout.splitlines():
                match = re.fullmatch(r'([a-z0-9][a-z0-9+.-]*(?::[a-z0-9-]+)?): (.+)', line)
                if match:
                    owner = match.group(1).split(':', 1)[0]
                    break
            if owner:
                break
    if not owner:
        raise RuntimeError('System library has no auditable package owner')
    packages.add(owner)
metadata = root / 'var/lib/dpkg/status.d'
metadata.mkdir(parents=True)
for package in sorted(packages):
    record = subprocess.check_output(['dpkg-query', '-s', package], text=True)
    (metadata / f'dentalai-{package}').write_text(record)
    copyright_file = Path('/usr/share/doc') / package / 'copyright'
    if copyright_file.is_file():
        # Distroless may symlink its own package doc directories. Preserve additional
        # licenses in a separate namespace rather than overwriting those links.
        destination = root / 'usr/share/doc/dentalai-runtime-provenance' / package / 'copyright'
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(copyright_file.resolve(), destination)
print('Runtime library package provenance:', ', '.join(sorted(packages)))
