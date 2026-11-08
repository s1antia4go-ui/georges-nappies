; Custom welcome page for the George's Nappies installer.

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to George's Nappies"
  !define MUI_WELCOMEPAGE_TEXT "Messaging, without the noise.$\r$\n$\r$\nThis will install George's Nappies on your computer and add it to your Desktop and Start menu.$\r$\n$\r$\n$\r$\nMade by Santiago Rojas"
  !insertmacro MUI_PAGE_WELCOME
!macroend
