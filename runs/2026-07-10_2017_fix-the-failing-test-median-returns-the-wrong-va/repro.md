# Repro

reproduced: true
command: npm test

node --test shows 2 pass, 1 fail. Failing test 'even-length median averages the middle pair' at test/stats.test.js:9 asserts median([1,2,3,4]) === 2.5 but got 3. Root cause visible in src/stats.js: median() always returns sorted[Math.floor(sorted.length/2)] with no branch for even-length arrays, so it never averages the two middle elements.
