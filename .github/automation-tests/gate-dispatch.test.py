"""Exercise the exact trusted workflow selection code with real event payloads."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

workflow = Path('.github/workflows/codex-reviewed-automerge.yml').read_text()
code = workflow.split("python3 - <<'PYTHON'\n")[1].split('          PYTHON')[0]
code = '\n'.join(line[10:] for line in code.splitlines())

class Selection(unittest.TestCase):
    def select(self, event, payload, value=''):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / 'event').write_text(json.dumps(payload))
            result = subprocess.run(['python3', '-c', code], capture_output=True, text=True,
                env={**os.environ, 'GITHUB_EVENT_NAME': event, 'GITHUB_EVENT_PATH': str(path / 'event'),
                    'MANUAL_PR': value, 'GITHUB_OUTPUT': str(path / 'output')})
            return result, (path / 'output').read_text() if (path / 'output').exists() else ''

    def test_manual(self):
        for value in ['84', '00084']:
            result, output = self.select('workflow_dispatch', {}, value)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(output, 'prs=[84]\n')

    def test_invalid(self):
        for value in ['', '84.0', '0', '-1', '1e2', '84;id', '84\n', ' 84', '2147483648']:
            result, output = self.select('workflow_dispatch', {}, value)
            self.assertNotEqual(result.returncode, 0, value)
            self.assertEqual(output, '')

    def test_events(self):
        for event in ['pull_request', 'pull_request_review', 'pull_request_review_comment', 'issue_comment']:
            payload = {'issue' if event == 'issue_comment' else 'pull_request': {'number': 84}}
            result, output = self.select(event, payload)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(output, 'prs=[84]\n')

class Publication(unittest.TestCase):
    def test_head_race_and_api_failure(self):
        shell = workflow.split('name: Publish the gate decision')[1].split('        run: |\n')[1].split('\n      - name:')[0]
        shell = '\n'.join(line[10:] for line in shell.splitlines())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            gh = path / 'gh'
            gh.write_text('#!/bin/bash\nif [[ "$1" == pr ]]; then echo "$CURRENT"; exit "${API_FAIL:-0}"; fi\necho "$*" >> "$CALLS"\n')
            gh.chmod(0o755)
            for current, failure, success in [('old', '0', False), ('head', '1', False), ('head', '0', True)]:
                calls = path / 'calls'
                calls.unlink(missing_ok=True)
                result = subprocess.run(['bash', '-c', shell], capture_output=True, text=True,
                    env={**os.environ, 'PATH': directory + ':' + os.environ['PATH'],
                         'CURRENT': current, 'API_FAIL': failure, 'CALLS': str(calls),
                         'PR': '84', 'HEAD': 'head', 'READY': 'true', 'GITHUB_REPOSITORY': 'zhrsidd/MUNOS', 'GITHUB_SERVER_URL': 'https://github.com', 'GITHUB_RUN_ID': '1'})
                self.assertEqual(result.returncode == 0, success, result.stderr)
                self.assertEqual(calls.exists(), success)

    def test_shared_serialization(self):
        self.assertIn('group: codex-merge-gate-${{ matrix.pr }}', workflow)
        self.assertIn('cancel-in-progress: false', workflow)
        self.assertIn('pr: ${{ fromJSON(needs.select.outputs.prs) }}', workflow)
        self.assertIn('--match-head-commit "$HEAD"', workflow)
        self.assertIn('ref: main', workflow)

class Reconciliation(unittest.TestCase):
    def test_candidate_filter_and_api_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            gh = path / 'gh'
            gh.write_text('#!/bin/bash\ncat "$CANDIDATES"\nexit "${API_FAIL:-0}"\n')
            gh.chmod(0o755)
            def pr(number, draft=False, repo='zhrsidd/MUNOS'):
                return {'number': number, 'draft': draft, 'head': {'repo': {'full_name': repo} if repo else None}}
            (path / 'candidates').write_text(json.dumps([[pr(84), pr(85, True), pr(86, repo='fork/MUNOS'), pr(87, repo=None)]]))
            (path / 'event').write_text('{}')
            env = {**os.environ, 'PATH': directory + ':' + os.environ['PATH'],
                   'CANDIDATES': str(path / 'candidates'), 'GITHUB_EVENT_NAME': 'schedule',
                   'GITHUB_EVENT_PATH': str(path / 'event'), 'GITHUB_OUTPUT': str(path / 'output'),
                   'GITHUB_REPOSITORY': 'zhrsidd/MUNOS'}
            result = subprocess.run(['python3', '-c', code], capture_output=True, text=True, env=env)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((path / 'output').read_text(), 'prs=[84]\n')
            (path / 'output').unlink()
            result = subprocess.run(['python3', '-c', code], capture_output=True, text=True, env={**env, 'API_FAIL': '1'})
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((path / 'output').exists())

if __name__ == '__main__':
    unittest.main()
