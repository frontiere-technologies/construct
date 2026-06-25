"""E2e tests for the self-registration flow."""
import time

import pytest


def test_registrati_link_opens_form(page, base_url):
    """Clicking 'Registrati' expands the inline registration form."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")

    page.click('text=Registrati')
    page.wait_for_selector('[data-testid="register-form"]')
    register_section = page.locator('[data-testid="register-form"]')
    assert register_section.is_visible()
    assert register_section.locator('button:has-text("Registrati")').is_visible()
    assert register_section.locator('button:has-text("Annulla")').is_visible()


def test_registrati_cancel_closes_form(page, base_url):
    """Clicking 'Annulla' hides the registration form."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.click('text=Registrati')
    page.wait_for_selector('[data-testid="register-form"]')

    page.click('button:has-text("Annulla")')
    page.wait_for_timeout(300)

    assert not page.locator('[data-testid="register-form"]').is_visible()


def test_register_unauthorized_domain_shows_confirmation(page, base_url):
    """Submitting an unauthorized domain silently shows the confirmation message (no info leak)."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.click('text=Registrati')
    page.wait_for_selector('[data-testid="register-form"]')

    register_section = page.locator('[data-testid="register-form"]')
    register_section.locator('input[type="email"]').fill('hacker@notallowed.xyz')
    register_section.locator('button[type="submit"]').click()

    page.wait_for_selector('text=Se l\'email è autorizzata riceverai un link per completare la registrazione.', timeout=5000)
    assert page.locator('text=Se l\'email è autorizzata riceverai un link per completare la registrazione.').is_visible()


def test_register_authorized_domain_shows_confirmation(page, base_url):
    """Submitting an authorized domain shows the confirmation message."""
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.click('text=Registrati')
    page.wait_for_selector('[data-testid="register-form"]')

    # Use a unique email to avoid duplicate-user conflicts across test runs
    unique_email = f"register-test-{int(time.time())}@frontiere.io"

    register_section = page.locator('[data-testid="register-form"]')
    register_section.locator('input[type="email"]').fill(unique_email)
    register_section.locator('button[type="submit"]').click()

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
    page.wait_for_selector('[data-testid="register-form"]')
    assert not page.locator('text=Inserisci la tua email per ricevere un link di reset.').is_visible()
