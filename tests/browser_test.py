"""End-to-end acceptance suite. Requires Python Playwright and a Chromium browser."""
import json
import os
import shutil
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def run():
    handler = partial(QuietHandler, directory=str(ROOT / "docs"))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    errors = []
    with tempfile.TemporaryDirectory() as temp, sync_playwright() as pw:
        profile = str(Path(temp) / "profile")
        executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
        def launch():
            return pw.chromium.launch_persistent_context(
                profile, executable_path=executable, headless=True,
                viewport={"width": 390, "height": 844}, timezone_id="Europe/London"
            )
        context = launch()
        page = context.new_page()
        page.set_default_timeout(7000)
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.on("dialog", lambda dialog: dialog.accept())
        def action(name, suffix=""):
            page.locator('[data-action="'+name+'"]'+suffix+':visible').first.click()
        def submit():
            page.locator('#editform [type=submit]').click()
            expect(page.locator("dialog")).not_to_be_visible()
        def check_layout():
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Horizontal overflow"
        def inspect_state(name="personal"):
            return page.evaluate("""async name => {
              const {openLedger}=await import('./storage.mjs');
              return await (await openLedger(name)).read();
            }""", name)
        page.goto(origin)
        expect(page.get_by_role("heading",name="Today",exact=True)).to_be_visible()
        page.evaluate("navigator.serviceWorker.ready.then(()=>true)")
        page.wait_for_function("!!navigator.serviceWorker.controller")
        check_layout()
        action("entry")
        action("entry-project")
        page.locator('[name=name]').fill("Design system")
        page.locator('[name=companyName]').fill("Pine Studio")
        page.locator('[name=rate]').fill("75.50")
        page.locator('#editform [type=submit]').click()
        expect(page.get_by_role("heading",name="Add work entry")).to_be_visible()
        form=page.locator('#editform')
        for name,val in {"startDate":"2026-02-10","endDate":"2026-02-10","startTime":"09:00","endTime":"11:45","breakMin":"15","notes":"First review"}.items():
            form.locator(f'[name={name}]').fill(val)
        form.locator('[name=billable]').check()
        form.locator('[name=reviewed]').check()
        expect(form.locator('[name=approved]')).to_have_value("150")
        form.locator('[name=status]').select_option("Invoiced")
        submit()
        state=inspect_state()
        assert len(state["entries"])==1 and state["entries"][0]["approved"]==9000000
        assert state["entries"][0]["rate"]==7550
        print("PASS first-run company, project, manual work, breaks, approval and invoice status",flush=True)
        action("quick")
        action("start-focus")
        expect(page.locator('.timer-row')).to_have_count(1)
        action("pause")
        action("resume")
        action("nav",'[data-page=Projects]')
        action("new-project")
        form.locator('[name=name]').fill("Research")
        submit()
        action("nav",'[data-page=Today]')
        action("quick",':has-text("Research")')
        action("start-focus")
        expect(page.locator('.timer-row')).to_have_count(2)
        action("quick",':has-text("Design system")')
        state=inspect_state()
        open_entries=[e for e in state["entries"] if e["end"] is None]
        assert len(open_entries)==2 and sum(e["segments"][-1][1] is None for e in open_entries)==2
        assert sum(bool(e["focus"]) and e["focus"][-1][1] is None for e in open_entries)==1
        print("PASS independent live timers, pause/resume and focus switching",flush=True)
        action("goals")
        form.locator('[name=hours]').fill("8")
        form.locator('[name=money]').fill("400")
        submit()
        expect(page.locator('.metric').first).to_contain_text("8h")
        action("period",'[data-value=month]')
        expect(page.locator('.metric').first).to_contain_text("No target set")
        action("collapse"); expect(page.locator('.metrics')).to_have_count(0)
        action("collapse")
        action("favourites")
        action("fav-up",':not([disabled])')
        action("close")
        expect(page.locator('.quick-main').first).to_contain_text("Research")
        print("PASS period selection, independent goals, collapsing and favourite reordering",flush=True)
        action("nav",'[data-page=Reports]')
        page.locator('.filters [name=period]').select_option('day')
        page.locator('.filters [name=anchor]').fill('2026-02-10')
        page.locator('.filters [name=anchor]').press('Tab')
        expect(page.locator('.report-entry')).to_have_count(1)
        expect(page.locator('.report-entry')).to_contain_text("£188.75")
        with page.expect_download() as event:
            action("export",'[data-value=CSV]')
        raw=Path(event.value.path()).read_text(encoding="utf-8-sig")
        assert "First review" in raw and "188.75" in raw
        page.evaluate("window.print=()=>{document.body.dataset.printed='true'}")
        action("export",'[data-value=Print]')
        expect(page.locator("body")).to_have_attribute("data-printed","true")
        assert "£188.75" in page.locator("#printout").text_content()
        action("entry",':has(svg[width="18"])')
        form.locator('[name=notes]').fill("Reviewed")
        submit()
        print("PASS filtered reports, CSV download, print document and editing",flush=True)
        action("settings")
        form.locator('[name=theme]').select_option('dark')
        submit()
        expect(page.locator('html')).to_have_attribute('data-theme','dark')
        action("settings");action("backup")
        with page.expect_download() as event:
            action("backup-save")
        backup=Path(temp)/"backup.json";event.value.save_as(backup)
        assert json.loads(backup.read_text())["data"]["schema"]==1
        form.locator('[name=backupFile]').set_input_files(str(backup))
        action("restore-merge")
        expect(page.locator('dialog')).not_to_be_visible()
        print("PASS appearance, full backup and duplicate-safe restore",flush=True)
        page.goto(origin+'/?example=1')
        expect(page.locator('.quick-card')).to_have_count(4)
        check_layout()
        page.set_viewport_size({"width":1440,"height":1000})
        check_layout()
        if os.environ.get("QA_IMAGE_DIR"):
            shots=Path(os.environ["QA_IMAGE_DIR"]);shots.mkdir(parents=True,exist_ok=True)
            page.screenshot(path=str(shots/"desktop.png"),full_page=True)
            page.set_viewport_size({"width":390,"height":844})
            page.screenshot(path=str(shots/"mobile.png"),full_page=True)
        context.close()
        server.shutdown();server.server_close()
        context=launch()
        context.set_offline(True)
        page=context.new_page()
        page.goto(origin,wait_until="domcontentloaded")
        expect(page.locator('.timer-row')).to_have_count(2)
        assert page.evaluate("navigator.onLine===false")
        state=inspect_state()
        assert len([e for e in state["entries"] if e["end"] is None])==2
        assert state["settings"]["theme"]=="dark"
        action("stop")
        expect(page.locator('.timer-row')).to_have_count(1)
        assert not errors,errors
        context.close()
        print("PASS cold Chromium restart, offline shell, saved timers and offline edits",flush=True)


if __name__=="__main__":
    run()
