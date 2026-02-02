# Bot steps for oseguidorsecreto.com/pv-en

**From user (Feb 2026)**

## Landing page structure

- **Initially NO input** – input appears/activates only after clicking the placeholder area
- Placeholder area: div/label with "Your Instagram" or "@ username"
- Click placeholder → CSS change → input becomes usable
- **"Get Your Free Report" button** is **disabled** until username is entered
- After typing username, React re-enables the button

## Correct bot flow

1. **Navigate** to `https://oseguidorsecreto.com/pv-en`
2. **Wait** for load + 3s hydration
3. **Click** somewhere on page (human sim)
4. **Capture** landing snapshot
5. **Click placeholder area** (div "Your Instagram", "@ username", or button fallback) – reveals/activates input
6. **Wait** 1s for input to appear
7. **Find** username input (`input[placeholder="username"]`)
8. **Click** input (focus – triggers CSS change)
9. **Type** username slowly (100ms per char)
10. **Wait** 3s for button to become enabled
11. **Click** "Get Your Free Report"
12. **Click** "Start My Analysis"
13. **Wait** for analyzing view
14. **Click** "Continue, the profile is correct"
15. **Wait** for processing
16. **Wait** for result cards
17. **Extract** card data
