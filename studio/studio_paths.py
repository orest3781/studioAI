"""Installed code is replaceable; the selected local runtime and data are not."""
import os
from pathlib import Path

CODE = Path(__file__).resolve().parent
WORKSPACE = Path(os.environ.get('STUDIO_WORKSPACE_ROOT', str(CODE.parent))).resolve()
RUNTIME = WORKSPACE / 'studio'
