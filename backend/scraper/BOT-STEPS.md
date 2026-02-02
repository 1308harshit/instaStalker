# Bot steps for oseguidorsecreto.com/pv-en

**Robust approach (Feb 2026)**

## Flow (no placeholder clicking)

1. **Navigate** to `https://oseguidorsecreto.com/pv-en`
2. **Wait** for load + 5s hydration
3. **Capture** landing snapshot
4. **Wait for input** via `waitForFunction` (DOM attached, bypasses CSS visibility tricks)
5. **Fill input** via `page.evaluate` (JS set value + dispatch input/change) – no typing = fewer bot signals
6. **Capture** `username-filled-dom-stable`
7. **Wait for button** via `waitForFunction` (React state: enabled when input has value)
8. **Click** "Get Your Free Report"
9. **Click** "Start My Analysis"
10. **Continue** (profile confirm, processing, results)
