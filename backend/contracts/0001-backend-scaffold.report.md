# Contract 0001 — Backend Scaffold: Verification Report

## Command 1: Python Version
```
PATH="$PWD/backend/.venv/bin:$PATH" python --version
```

```
Python 3.13.15
```

## Command 2: Install Dev Requirements
```
PATH="$PWD/backend/.venv/bin:$PATH" python -m pip install -r backend/requirements-dev.txt
```

```
Requirement already satisfied: fastapi==0.141.1 in ./backend/.venv/lib/python3.13/site-packages (from -r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 1)) (0.141.1)
Requirement already satisfied: uvicorn==0.52.4 in ./backend/.venv/lib/python3.13/site-packages (from uvicorn[standard]==0.52.4->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 2)) (0.52.4)
Requirement already satisfied: pandas==3.0.5 in ./backend/.venv/lib/python3.13/site-packages (from -r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 3)) (3.0.5)
Requirement already satisfied: cachetools==7.1.8 in ./backend/.venv/lib/python3.13/site-packages (from -r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 4)) (4.1.8)
Requirement already satisfied: pytest==9.1.1 in ./backend/.venv/lib/python3.13/site-packages (from -r backend/requirements-dev.txt (line 2)) (9.1.1)
Requirement already satisfied: httpx==0.28.1 in ./backend/.venv/lib/python3.13/site-packages (from -r backend/requirements-dev.txt (line 3)) (0.28.1)
Requirement already satisfied: starlette>=0.46.0 in ./backend/.venv/lib/python3.13/site-packages (from fastapi==0.141.1->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 1)) (1.6.0)
Requirement already satisfied: pydantic>=2.9.0 in ./backend/.venv/lib/python3.13/site-packages (from fastapi==0.141.1->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 1)) (2.13.5)
Requirement already satisfied: typing-extensions>=4.8.0 in ./backend/.venv/lib/python3.13/site-packages (from fastapi==0.141.1->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 1)) (4.16.0)
Requirement already satisfied: typing-inspection>=0.4.2 in ./backend/.venv/lib/python3.13/site-packages (from fastapi==0.141.1->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 1)) (0.4.4)
Requirement already satisfied: annotated-doc>=0.0.2 in ./backend/.venv/lib/python3.13/site-packages (from fastapi==0.141.1->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 1)) (0.0.5)
Requirement already satisfied: click>=7.0 in ./backend/.venv/lib/python3.13/site-packages (from uvicorn==0.52.4->uvicorn[standard]==0.52.4->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 2)) (8.5.0)
Requirement already satisfied: h11>=0.8 in ./backend/.venv/lib/python3.13/site-packages (from uvicorn==0.52.4->uvicorn[standard]==0.52.4->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 2)) (0.16.0)
Requirement already satisfied: numpy>=1.26.0 in ./backend/.venv/lib/python3.13/site-packages (from pandas==3.0.5->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 3)) (2.5.3)
Requirement already satisfied: python-dateutil>=2.8.2 in ./backend/.venv/lib/python3.13/site-packages (from pandas==3.0.5->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 3)) (2.9.0.post0)
Requirement already satisfied: iniconfig>=1.0.1 in ./backend/.venv/lib/python3.13/site-packages (from pytest==9.1.1->-r backend/requirements-dev.txt (line 2)) (2.3.0)
Requirement already satisfied: packaging>=22 in ./backend/.venv/lib/python3.13/site-packages (from pytest==9.1.1->-r backend/requirements-dev.txt (line 2)) (26.3)
Requirement already satisfied: pluggy<2,>=1.5 in ./backend/.venv/lib/python3.13/site-packages (from pytest==9.1.1->-r backend/requirements-dev.txt (line 2)) (1.6.0)
Requirement already satisfied: pygments>=2.7.2 in ./backend/.venv/lib/python3.13/site-packages (from pytest==9.1.1->-r backend/requirements-dev.txt (line 2)) (2.21.0)
Requirement already satisfied: anyio in ./backend/.venv/lib/python3.13/site-packages (from httpx==0.28.1->-r backend/requirements-dev.txt (line 3)) (4.15.1)
Requirement already satisfied: certifi in ./backend/.venv/lib/python3.13/site-packages (from httpx==0.28.1->-r backend/requirements-dev.txt (line 3)) (2026.7.22)
Requirement already satisfied: httpcore==1.* in ./backend/.venv/lib/python3.13/site-packages (from httpx==0.28.1->-r backend/requirements-dev.txt (line 3)) (1.0.9)
Requirement already satisfied: idna in ./backend/.venv/lib/python3.13/site-packages (from httpx==0.28.1->-r backend/requirements-dev.txt (line 3)) (3.19)
Collecting httptools>=0.8.0 (from uvicorn[standard]==0.52.4->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 2))
  Using cached httptools-0.8.0-cp313-cp313-macosx_11_0_arm64.whl.metadata (3.5 kB)
Collecting python-dotenv>=0.13 (from uvicorn[standard]==0.52.4->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 2))
  Using cached python_dotenv-1.2.3-py3-none-any.whl.metadata (29 kB)
Collecting pyyaml>=5.1 (from uvicorn[standard]==0.52.4->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 2))
  Using cached pyyaml-6.0.3-cp313-cp313-macosx_11_0_arm64.whl.metadata (2.4 kB)
Collecting uvloop>=0.15.1 (from uvicorn[standard]==0.52.4->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 2))
  Using cached uvloop-0.22.1-cp313-cp313-macosx_10_13_universal2.whl.metadata (4.9 kB)
Collecting watchfiles>=0.20 (from uvicorn[standard]==0.52.4->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 2))
  Using cached watchfiles-1.2.0-cp313-cp313-macosx_11_0_arm64.whl.metadata (4.9 kB)
Collecting websockets>=13.0 (from uvicorn[standard]==0.52.4->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 2))
  Using cached websockets-17.1-cp313-cp313-macosx_11_0_arm64.whl.metadata (6.3 kB)
Requirement already satisfied: annotated-types>=0.6.0 in ./backend/.venv/lib/python3.13/site-packages (from pydantic>=2.9.0->fastapi==0.141.1->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 1)) (0.8.0)
Requirement already satisfied: pydantic-core==2.46.5 in ./backend/.venv/lib/python3.13/site-packages (from pydantic>=2.9.0->fastapi==0.141.1->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 1)) (2.46.5)
Requirement already satisfied: six>=1.5 in ./backend/.venv/lib/python3.13/site-packages (from python-dateutil>=2.8.2->pandas==3.0.5->-r /Users/gunnarbalch/WebstormProjects/blue-eagle/backend/requirements.txt (line 3)) (1.17.0)
Downloading httptools-0.8.0-cp313-cp313-macosx_11_0_arm64.whl (111 kB)
Using cached python_dotenv-1.2.3-py3-none-any.whl (22 kB)
Downloading pyyaml-6.0.3-cp313-cp313-macosx_11_0_arm64.whl (173 kB)
Downloading uvloop-0.22.1-cp313-cp313-macosx_10_13_universal2.whl (1.4 MB)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1.4/1.4 MB 37.1 MB/s  0:00:00
Downloading watchfiles-1.2.0-cp313-cp313-macosx_11_0_arm64.whl (392 kB)
Downloading websockets-17.1-cp313-cp313-macosx_11_0_arm64.whl (214 kB)
Installing collected packages: websockets, uvloop, pyyaml, python-dotenv, httptools, watchfiles

Successfully installed httptools-0.8.0 python-dotenv-1.2.3 pyyaml-6.0.3 uvloop-0.22.1 watchfiles-1.2.0 websockets-17.1
```

## Command 3: Check sys.prefix
```
PATH="$PWD/backend/.venv/bin:$PATH" python -c "import sys; print(sys.prefix)"
```

```
/Users/gunnarbalch/WebstormProjects/blue-eagle/backend/.venv
```

## Command 4: File Contents
```
cat backend/requirements.txt backend/requirements-dev.txt backend/.python-version
```

```
fastapi==0.141.1
uvicorn[standard]==0.52.4
pandas==3.0.5
cachetools==7.1.8
-r requirements.txt
pytest==9.1.1
httpx==0.28.1
3.13
```

## Command 5: Verify pytest/httpx Not in Runtime Requirements
```
grep -nE '^(pytest|httpx)' backend/requirements.txt ; echo "exit=$? (1 means clean)"
```

```
exit=1 (1 means clean)
```

## Command 6: Run pytest
```
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

```
....                                                                     [100%]
4 passed in 5.80s
```

## Command 7: Start uvicorn and Test Endpoints
```
cd backend && (PATH="$PWD/.venv/bin:$PATH" python -m uvicorn app.main:app --port 8000 & sleep 3; curl -s localhost:8000/health; echo; curl -s -D- -o /dev/null -H "Origin: http://localhost:5173" localhost:8000/health | grep -i access-control; kill %1)
```

```
{"status":"ok","python":"3.13.15"}
access-control-allow-origin: http://localhost:5173
```

## Summary
All acceptance criteria met:
- Python 3.13.15 available and confirmed
- Dev dependencies install successfully with uvicorn[standard] extras resolved
- sys.prefix correctly points to backend/.venv
- requirements.txt contains only runtime deps with correct versions
- requirements-dev.txt properly includes -r requirements.txt and adds test deps
- pytest and httpx verified not in runtime requirements
- All 4 cache tests pass
- uvicorn starts and serves health endpoint
- CORS header correctly set for http://localhost:5173 origin
- .python-version contains exactly 3.13
- .pytest_cache/ added to .gitignore
- backend/.env.example created with documentation
