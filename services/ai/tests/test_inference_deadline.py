import time
from app.runtime import Runtime


def test_runtime_cancels_without_producing_results():
    class InterruptedSession:
        def run(self, _outputs, _inputs, run_options):
            deadline = time.monotonic() + 1
            while not run_options.terminate and time.monotonic() < deadline:
                time.sleep(0.001)
            assert run_options.terminate
            raise TimeoutError('Cancelled')
    runtime = Runtime.__new__(Runtime)
    runtime.session = InterruptedSession()
    runtime.input_name = 'input'
    try:
        runtime._run(None, timeout_seconds=0.01)
        assert False, 'Interrupted execution must never return results'
    except TimeoutError:
        pass
