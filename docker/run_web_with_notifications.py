"""Run web and notification processes together on a single-container host."""
import signal
import subprocess
import sys
import time


def main():
    children = []
    stopping = False

    def stop(*_):
        nonlocal stopping
        stopping = True

    for name in ('SIGTERM', 'SIGINT'):
        signal.signal(getattr(signal, name), stop)

    exit_code = 0
    try:
        children.append(subprocess.Popen(sys.argv[1:]))
        children.append(subprocess.Popen([sys.executable, 'manage.py', 'run_route_notifications']))
        while not stopping:
            for child in children:
                result = child.poll()
                if result is not None:
                    print(f'Process {child.pid} exited ({result}); stopping container.', flush=True)
                    exit_code = result or 1
                    stopping = True
                    break
            if not stopping:
                time.sleep(0.5)
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        deadline = time.monotonic() + 25
        for child in children:
            try:
                child.wait(timeout=max(0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
    return exit_code


if __name__ == '__main__':
    raise SystemExit(main())
