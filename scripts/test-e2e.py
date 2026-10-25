import time
import json
from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--enable-gpu",
                "--use-gl=angle",
                "--use-angle=default",
                "--ignore-gpu-blocklist",
            ]
        )
        context = browser.new_context(viewport={"width": 1600, "height": 900})
        page = context.new_page()

        console_errors = []
        console_warnings = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else console_warnings.append(msg.text) if msg.type == "warning" else None)
        page.on("pageerror", lambda err: console_errors.append(str(err)))

        print("Navigating to http://localhost:5199...")
        page.goto("http://localhost:5199")
        page.wait_for_timeout(2000)

        # Take screenshot of home page / session browser
        page.screenshot(path="gui-test-screenshots/e2e-01-home.png")
        print("Captured home page screenshot.")

        # Click the signature replay button
        print("Clicking signature replay...")
        sig_btn = page.locator("button.browser__hero-btn")
        if sig_btn.count() > 0:
            sig_btn.click()
        else:
            # Fallback locator
            page.locator("text=OR RELIVE THE SIGNATURE REPLAY").click()

        # Wait for theatre to mount
        page.wait_for_selector(".theatre", timeout=15000)
        page.wait_for_timeout(3000)
        page.screenshot(path="gui-test-screenshots/e2e-02-theatre-mounted.png")
        print("Theatre mounted successfully!")

        # Dismiss onboarding if present
        brief_btn = page.locator("button.brief__go")
        if brief_btn.count() > 0:
            print("Dismissing onboarding via brief__go...")
            brief_btn.click()
            page.wait_for_timeout(500)

        page.screenshot(path="gui-test-screenshots/e2e-03-onboarding-dismissed.png")

        # Cycle density dial: D key
        print("Testing density cycles...")
        page.keyboard.press("KeyD")
        page.wait_for_timeout(600)
        page.keyboard.press("KeyD")
        page.wait_for_timeout(600)
        page.keyboard.press("KeyD")
        page.wait_for_timeout(600)

        # Test camera modes: 1, 2, 3, 4
        print("Testing camera modes...")
        for key in ["Digit1", "Digit2", "Digit3", "Digit4"]:
            page.keyboard.press(key)
            page.wait_for_timeout(600)

        # Return to director / follow
        page.keyboard.press("Digit1")
        page.wait_for_timeout(600)

        # Click a timing row to focus a driver
        print("Clicking timing row...")
        row = page.locator(".tower__row").first
        if row.count() > 0:
            row.click()
            page.wait_for_timeout(1000)
        page.screenshot(path="gui-test-screenshots/e2e-04-driver-focused.png")

        # Enter anatomy mode (Digit5)
        print("Entering anatomy mode (Digit5)...")
        page.keyboard.press("Digit5")
        page.wait_for_timeout(1500)
        page.screenshot(path="gui-test-screenshots/e2e-05-anatomy-mode.png")

        # Check HUD state
        anat_hud = page.locator(".anat")
        hud_visible = anat_hud.get_attribute("data-visible")
        part_text = anat_hud.locator(".anat__part b").inner_text()
        print(f"Anatomy HUD data-visible={hud_visible}, part_text={part_text}")

        # Test chip clicking in HUD
        print("Testing chip clicks in HUD...")
        chips = page.locator(".anat__chip")
        chip_count = chips.count()
        print(f"Found {chip_count} part chips in HUD.")
        for i in range(min(4, chip_count)):
            chip = chips.nth(i)
            chip_name = chip.inner_text()
            chip.click()
            page.wait_for_timeout(400)
            cur_part = anat_hud.locator(".anat__part b").inner_text()
            body_rows = anat_hud.locator(".anat__row").all_inner_texts()
            print(f"Clicked chip '{chip_name}' -> HUD part: '{cur_part}', telemetry: {body_rows}")

        page.screenshot(path="gui-test-screenshots/e2e-06-chip-clicked.png")

        # Test workshop light toggle
        print("Testing workshop light toggle (KeyL)...")
        page.keyboard.press("KeyL")
        page.wait_for_timeout(600)
        page.screenshot(path="gui-test-screenshots/e2e-07-light-on.png")
        page.keyboard.press("KeyL")
        page.wait_for_timeout(600)

        # Test clicking directly on the canvas in anatomy mode
        print("Testing canvas clicking in anatomy mode...")
        canvas = page.locator("canvas[data-engine]")
        box = canvas.bounding_box()
        if box:
            cx = box["x"] + box["width"] / 2
            cy = box["y"] + box["height"] / 2
            # Try clicks around center where the car sits
            for offset_x, offset_y in [(0, 0), (20, -10), (-30, 15), (50, 0), (-60, -20)]:
                page.mouse.click(cx + offset_x, cy + offset_y)
                page.wait_for_timeout(300)
                cur_part = anat_hud.locator(".anat__part b").inner_text()
                print(f"Clicked at ({offset_x}, {offset_y}) -> HUD part: '{cur_part}'")

        page.screenshot(path="gui-test-screenshots/e2e-08-canvas-clicked.png")

        # Exit anatomy mode with Escape
        print("Exiting anatomy mode with Escape...")
        page.keyboard.press("Escape")
        page.wait_for_timeout(1000)

        # Check callouts SVG in BROADCAST / ENGINEER mode
        callouts_svg = page.locator("svg.callouts")
        gate_lines = page.locator(".callout__gate-line").count()
        corner_lines = page.locator(".callout__corner-line").count()
        car_callouts = page.locator(".callout").count()
        print(f"Callouts layer: {gate_lines} gate lines, {corner_lines} corner lines, {car_callouts} car callouts")

        page.screenshot(path="gui-test-screenshots/e2e-09-callouts-final.png")

        # Check for errors
        print("\n--- Summary ---")
        print(f"Console errors ({len(console_errors)}):")
        for err in console_errors:
            print(f"  [ERROR] {err}")
        print(f"Console warnings ({len(console_warnings)}):")
        for warn in console_warnings[:10]:
            print(f"  [WARN] {warn}")

        browser.close()

if __name__ == "__main__":
    run()
