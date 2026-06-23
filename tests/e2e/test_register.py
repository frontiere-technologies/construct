"""E2e tests for the self-registration flow."""
import pytest


def test_registrati_link_opens_form(page, base_url):
    """Clicking 'Registrati' expands the inline registration form."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")

    # The form should not be visible initially
    assert not page.locator('input[placeholder="nome@esempio.it"]').is_visible() or \
           page.locator('text=Inserisci la tua email per ricevere un link di registrazione.').count() == 0

    page.click('text=Registrati')
    page.wait_for_selector('text=Inserisci la tua email per ricevere un link di registrazione.')

    assert page.locator('text=Inserisci la tua email per ricevere un link di registrazione.').is_visible()
    assert page.locator('button:has-text("Registrati")').is_visible()
    assert page.locator('button:has-text("Annulla")').is_visible()


def test_registrati_cancel_closes_form(page, base_url):
    """Clicking 'Annulla' hides the registration form."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.click('text=Registrati')
    page.wait_for_selector('text=Inserisci la tua email per ricevere un link di registrazione.')

    page.click('button:has-text("Annulla")')
    page.wait_for_timeout(300)

    assert not page.locator('text=Inserisci la tua email per ricevere un link di registrazione.').is_visible()


def test_register_unauthorized_domain_shows_confirmation(page, base_url):
    """Submitting an unauthorized domain silently shows the confirmation message (no info leak)."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.click('text=Registrati')
    page.wait_for_selector('text=Inserisci la tua email per ricevere un link di registrazione.')

    # Target the registration form email input specifically (use .last to get the registration form's input, not the main login one)
    register_section = page.locator('text=Inserisci la tua email per ricevere un link di registrazione.').locator('..')
    email_input = register_section.locator('input[type="email"]')
    email_input.fill('hacker@notallowed.xyz')

    # Click the last "Registrati" button (the one in the registration form, not the main login)
    page.locator('button[type="submit"]:has-text("Registrati")').last.click()

    page.wait_for_selector('text=Se l\'email è autorizzata riceverai un link per completare la registrazione.', timeout=5000)
    assert page.locator('text=Se l\'email è autorizzata riceverai un link per completare la registrazione.').is_visible()


def test_register_authorized_domain_shows_confirmation(page, base_url):
    """Submitting an authorized domain shows the confirmation message."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.click('text=Registrati')
    page.wait_for_selector('text=Inserisci la tua email per ricevere un link di registrazione.')

    # Use a unique email to avoid duplicate-user conflicts across test runs
    import time
    unique_email = f"register-test-{int(time.time())}@frontiere.io"

    # Target the registration form email input specifically
    register_section = page.locator('text=Inserisci la tua email per ricevere un link di registrazione.').locator('..')
    email_input = register_section.locator('input[type="email"]')
    email_input.fill(unique_email)

    # Click the last "Registrati" button (the one in the registration form)
    page.locator('button[type="submit"]:has-text("Registrati")').last.click()

    page.wait_for_selector('text=Se l\'email è autorizzata riceverai un link per completare la registrazione.', timeout=5000)
    assert page.locator('text=Se l\'email è autorizzata riceverai un link per completare la registrazione.').is_visible()


def test_registrati_and_forgotmode_are_mutually_exclusive(page, base_url):
    """Opening 'Registrati' closes 'Password dimenticata?' and vice versa."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")

    # Open forgot-password
    page.click('button:has-text("Password dimenticata?")')
    page.wait_for_selector('text=Inserisci la tua email per ricevere un link di reset.')

    # Open register — should close forgot
    page.click('text=Registrati')
    page.wait_for_selector('text=Inserisci la tua email per ricevere un link di registrazione.')
    assert not page.locator('text=Inserisci la tua email per ricevere un link di reset.').is_visible()
