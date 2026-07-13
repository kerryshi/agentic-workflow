# Evidence

Isolated diagnostic (`diag_r14.ps1`) output:

```
Console.OutputEncoding=IBM437  $OutputEncoding=us-ascii

--- CURRENT approach: ls-files -> PS string -> per-file add -N ---
  name='café.txt' codes=[63 61 66 251C 2310 2E 74 78 74] existsOnDisk=False
    add -N -> LASTEXITCODE=128
  name='newfile.txt' codes=[6E 65 77 66 69 6C 65 2E 74 78 74] existsOnDisk=True
    add -N -> LASTEXITCODE=0
  patch contains 'brand new'    : True
  patch contains 'accented name': False   <-- BUG when False

--- FIX approach: throwaway index copy + 'git add -N -- .' (git self-enumerates) ---
  patch contains 'brand new'    : True
  patch contains 'accented name': True   <-- FIXED when True
  real index untouched (staged files after fix, want 0): 0
```

Harness before the fix: `31 passed, 1 failed` (8/8 runs). After: `32 passed, 0 failed` (10/10 runs).
