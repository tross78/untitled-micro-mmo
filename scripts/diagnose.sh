#!/bin/bash
# Hearthwick failure diagnosis — run when npm test fails.
# Produces structured output that is easier to act on than raw Jest output.
# Usage: npm run diagnose

RAW=$(npx jest --no-coverage 2>&1)
EXIT=$?

if [ $EXIT -eq 0 ]; then
    echo "All tests passed. Nothing to diagnose."
    exit 0
fi

echo "================================================================"
echo "  FAILING TESTS"
echo "================================================================"

# Extract failing test suite names
echo "$RAW" | grep "^FAIL " | while read -r line; do
    echo "  Suite: $line"
done

echo ""
echo "================================================================"
echo "  ERROR DETAILS"
echo "================================================================"

# Print each error block: the ● header + the lines until the next ● or blank section
echo "$RAW" | awk '
    /^  ●/ { found=1; count=0 }
    found {
        print
        count++
        # Stop after 20 lines per error block to avoid wall of text
        if (count > 20) { print "  ... (truncated)"; found=0 }
    }
    /^Test Suites:/ { found=0 }
'

echo ""
echo "================================================================"
echo "  SUMMARY"
echo "================================================================"
echo "$RAW" | grep -E "^Tests:|^Test Suites:|^Snapshots:|^Time:"

echo ""
echo "================================================================"
echo "  NEXT STEPS"
echo "================================================================"
echo "  1. Identify which test is failing (suite + test name above)."
echo "  2. Find the file it lives in under src/*.test.js."
echo "  3. Read that test to understand what contract it enforces."
echo "  4. Read the source file the test imports — look at the function it calls."
echo "  5. Make ONE targeted fix. Run 'npm test' immediately after."
echo "  6. If still failing after 2 attempts, stop and ask for guidance."

exit $EXIT
