from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1600, "height": 900})
        page = context.new_page()

        page.goto("http://localhost:5199")
        page.wait_for_timeout(2000)

        # Signature replay
        sig_btn = page.locator("button.browser__hero-btn")
        if sig_btn.count() > 0:
            sig_btn.click()
        else:
            page.locator("text=OR RELIVE THE SIGNATURE REPLAY").click()

        page.wait_for_selector(".theatre", timeout=15000)
        page.wait_for_timeout(2000)

        # Dismiss brief
        brief_btn = page.locator("button.brief__go")
        if brief_btn.count() > 0:
            brief_btn.click()
            page.wait_for_timeout(500)

        # Hover over corner 1 chip
        c1 = page.locator(".callout__corner").first
        box = c1.bounding_box()
        if box:
            page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            page.wait_for_timeout(600)
            page.screenshot(path="gui-test-screenshots/e2e-10-corner-hover.png")
            print("Captured corner 1 hover screenshot!")

        browser.close()

if __name__ == "__main__":
    run()
