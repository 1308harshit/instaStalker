# Bot steps for oseguidorsecreto.com/pv-en

**From user screenshots (Feb 2026)**

## Landing page structure

- **Username input** visible from load: `input[placeholder="username"]`, type="text"
- **"Get Your Free Report" button** is **disabled** until username is entered
- After typing username, React re-enables the button

## Correct bot flow

1. **Navigate** to `https://oseguidorsecreto.com/pv-en`
2. **Wait** for load + 3s hydration
3. **Click** somewhere on page (human sim)
4. **Capture** landing snapshot
5. **Find** username input (`input[placeholder="username"]`)
6. **Click** input (focus)
7. **Type** username character-by-character
8. **Wait** 3s for button to become enabled
9. **Click** "Get Your Free Report" (only when `:not([disabled])`)
10. **Wait** for next page
11. **Click** "Start My Analysis" (if present)
12. **Wait** for analyzing view
13. **Click** "Continue, the profile is correct"
14. **Wait** for processing
15. **Wait** for result cards
16. **Extract** card data
