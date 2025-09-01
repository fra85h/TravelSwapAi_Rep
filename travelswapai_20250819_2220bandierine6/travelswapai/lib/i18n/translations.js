// lib/i18n/translations.js
export const defaultLocale = "it";

export const translations = {
  /* ===========================
   * ITALIANO (DEFAULT)
   * =========================== */
  it: {
    // --- Generici ---
    common: {
      yes: "Sì",
      no: "No",
      ok: "OK",
      cancel: "Annulla",
      save: "Salva",
      edit: "Modifica",
      delete: "Elimina",
      back: "Indietro",
      next: "Avanti",
      continue: "Continua",
      close: "Chiudi",
      loading: "Caricamento…",
      error: "Errore",
      retry: "Riprova",
      confirm: "Conferma",
      clear: "Pulisci",
      start: "Inizia",
      skip: "Salta"
    },

    // --- Tab bar / Sezioni ---
    tabs: {
      home: "All",
      offers: "Le mie offerte",
      create: "Crea",
      messages: "Messaggi",
      profile: "Il mio profilo",
    },

    // --- Titoli usati in MainTabs ---
    listingsTitle: "Annunci",
    offers: "Offerte",
    aiMatching: "My AI Matches",
    home: "Home",
    profile: "Profilo",
    receivedOffers: "Offerte ricevute",

   listings: {
  // filtri barra annunci
  filters: {
    all: "Tutti",      // it
    trains: "Treni",
    hotels: "Hotel",
    flights: "Voli",
  },
},
    // --- Profilo ---
    profile: {
      title: "Profilo",
      editProfile: "Modifica profilo",
      logout: "Esci",
      myListings: "I miei annunci",
      publishListing: "Pubblica annuncio",
      premium: "Abbonati Premium",
      saved: "Profilo aggiornato",
    },

    // --- Annunci / Listing ---
    listing: {
      type: { hotel: "Hotel", train: "Treno" },
      untitled: "Senza titolo",
      publishedOn: "Pubblicato il",
      filterPrefix: "Filtro:",
      showAll: "Mostra tutti",

      // Stati (badge + filtri + contatori)
      state: {
        active: "Attivo",
        swapped: "Scambiato",
        sold: "Venduto",
        pending: "In revisione",
        expired: "Scaduto",
      },
      filters: {
        active: "Attivi",
        swapped: "Scambiati",
        sold: "Venduti",
        pending: "In revisione",
        expired: "Scaduti",
      },

      // Azioni (overflow / action sheet)
      actions: {
        pause: "Metti in pausa",
        activate: "Rendi attivo",
        deleteTitle: "Elimina annuncio",
        deleteConfirm: "Vuoi eliminare “{title}”?",
        more: "Azioni",
      },

      // Empty states
      empty: "Non hai ancora annunci",
      emptyForFilter: "Nessun annuncio per questo stato",
      tryChangeFilter: "Prova a cambiare filtro.",
      usePlus: "Usa il pulsante + per crearne uno.",
    },

    // --- Create Listing ---
    createListing: {
      title: "Nuovo annuncio",
      step1: "Dati principali",
      step2: "Dettagli & pubblicazione",

      type: "Tipo",
      cercoVendoLabel: "Tipo annuncio",
      cerco: "Cerco",
      vendo: "Vendo",
      titleLabel: "Titolo *",
      titlePlaceholderHotel: "Es. Camera doppia vicino Duomo",
      titlePlaceholderTrain: "Es. Milano → Roma (FR 9520)",
      locationLabel: "Località *",
      locationPlaceholderHotel: "Es. Milano, Navigli",
      locationPlaceholderTrain: "Es. Milano Centrale → Roma Termini",

      checkIn: "Check-in",
      checkOut: "Check-out",
      departAt: "Partenza (data e ora)",
      arriveAt: "Arrivo (data e ora)",

      description: "Descrizione",
      descriptionPlaceholder: "Dettagli utili per chi è interessato…",
      price: "Prezzo *",
      pricePlaceholder: "Es. 120",
      imageUrl: "URL immagine",
      imageHint: "Aggiungi un URL immagine per vedere l’anteprima",
      imageLoadError: "Impossibile caricare l’immagine",

      aiImport: "AI Import 1-click",
      aiImportDesc:
        "Importa automaticamente i dati dell’annuncio leggendo un QR code oppure inserendo il PNR.",
      aiMagic: "Magia AI ✨",
      ai: {
        title: "Magia AI ✨",
        applied:
          "Ho suggerito alcuni campi per questo step. Puoi sempre modificarli.",
        error: "Impossibile generare suggerimenti.",
        hotelTitle: "Soggiorno 2 notti in centro",
        hotelLocation: "Milano, Duomo",
        hotelDesc:
          "Camera doppia con colazione. Check-in flessibile, vicino ai mezzi.",
        trainTitle: "Frecciarossa Milano → Roma",
        trainLocation: "Milano Centrale → Roma Termini",
        trainDesc:
          "Posto a sedere confermato, vagone silenzio. Biglietto cedibile.",
      },

      train: {
        particulars: "Dati particolari treno",
        namedTicket: "Biglietto nominativo",
        genderNote:
          "Se attivo, indica il genere presente sul biglietto.",
        genderLabel: "Genere *",
        pnrLabel: "PNR (opzionale)",
        pnrPlaceholder: "Es. ABCDEF",
        pnrPrivacy: "Il PNR non sarà visibile nell’annuncio.",
      },

      orEnterPnr: "Oppure inserisci PNR",
      importFromPnr: "Importa da PNR",
      pnrMissingTitle: "PNR mancante",
      pnrMissingMsg: "Inserisci un codice PNR o biglietto.",

      scanQr: "Scansiona QR",
      scanQrUnavailable: "Scansiona QR (non disponibile)",
      qrPromptTitle: "Inquadra il QR del biglietto",
      scannerUnavailable: "Scanner non disponibile",
      scannerUnavailableTitle: "Scanner non disponibile",
      scannerUnavailableMsg:
        "Il modulo fotocamera non è presente. Usa l’inserimento PNR.",
      cameraDeniedTitle: "Permesso negato",
      cameraDeniedMsg:
        "Per usare lo scanner, consenti l’accesso alla fotocamera.",
      cameraRequestError:
        "Impossibile richiedere i permessi fotocamera.",
      aiImportSuccess: "Dati importati correttamente.",
      aiImportError: "Impossibile importare dal PNR.",
      aiImportFromQr: "Dati importati dal QR.",
      qrImportError: "Import da QR non riuscito.",
      simulateScan: "Simula scan",

      saveDraft: "Salva bozza",
      publishedTitle: "Pubblicato 🎉",
      publishedMsg:
        "Il tuo annuncio è stato pubblicato con successo.",
      publish: "Pubblica",
      publishError:
        "Impossibile pubblicare l’annuncio.",
      draftSavedTitle: "Bozza salvata",
      draftSavedMsg:
        "Puoi riprenderla in qualsiasi momento.",
      draftSaveError:
        "Non sono riuscito a salvare la bozza.",

      pickTime: "Scegli ora",

      errors: {
        titleRequired: "Titolo obbligatorio.",
        locationRequired: "Località obbligatoria.",
        checkInRequired: "Check-in obbligatorio.",
        checkOutRequired: "Check-out obbligatorio.",
        checkInInvalid: "Check-in non valido (YYYY-MM-DD).",
        checkOutInvalid: "Check-out non valido (YYYY-MM-DD).",
        checkoutBeforeCheckin:
          "Il check-out non può precedere il check-in.",
        departRequired: "Data/ora partenza obbligatoria.",
        arriveRequired: "Data/ora arrivo obbligatoria.",
        departInvalid:
          "Partenza non valida (YYYY-MM-DD HH:mm).",
        arriveInvalid:
          "Arrivo non valido (YYYY-MM-DD HH:mm).",
        arriveBeforeDepart:
          "L’arrivo non può precedere la partenza.",
        genderRequired: "Seleziona M o F.",
        priceRequired: "Prezzo obbligatorio.",
        priceInvalid: "Prezzo non valido.",
      },
    },

    // --- Offerte ---
    offers: {
      title: "Offerte",
      accept: "Accetta",
      decline: "Rifiuta",
      cancel: "Cancella",
      accepted: "Proposta accettata",
      declined: "Proposta rifiutata",
      canceled: "Proposta cancellata",
      buy: "Acquisto",
      swap: "Scambio",
      for: "Per",
      from: "Da",
      to: "A",
      user: "utente",
      offered: "Offerto",
      amount: "Importo",
      proposals: "Proposte",
      incoming: "Ricevute",
      outgoing: "Inviate",
      none: "Nessuna proposta",
      receivedOffers: "Offerte ricevute",
      sentOffers: "Offerte inviate",
      proposePurchase: "Proponi acquisto",   // IT
      proposeSwap: "Proponi scambio",        // IT  
    },

    // --- Dettaglio offerta ---
    offerDetail: {
      title: "Dettaglio offerta",
      proposals: "Dettaglio proposte",
      listing: "Annuncio",
      notFound: "Annuncio non trovato.",
      buyProposal: "Proposta di acquisto",
      swapProposal: "Proposta di scambio",
      from: "Da",
      fromUser: "Da",
      to: "per",
      offerAmount: "Offerta",
      description: "Descrizione",
      price: "Prezzo",
      contact: "Contatta host",
      book: "Prenota",
    },

    // --- Altre sezioni / flussi ---
    offerFlow: {
      title: "Nuova offerta",
      stepDestination: "Scegli la destinazione",
      stepDates: "Seleziona date",
      stepConfirm: "Conferma",
      next: "Avanti",
      back: "Indietro",
      confirm: "Conferma",
    },

    listingDetail: {
      title: "Dettaglio annuncio",
      description: "Descrizione",
      price: "Prezzo",
    },

    matching: {
  title: "AI Matching",
aiMatching: "My AI Matches",
    new: "Nuovo",
    noResults: "Nessun risultato.",
    legendTitle: "Cosa significano 60 / 70 / 80?",
    legend60: "60–69 = compatibilità di base",
    legend70: "70–79 = buona compatibilità",
    legend80: "80–100 = affinità eccellente",
    legendExplanation:
      "Il punteggio è una stima (0–100) calcolata da TravelSwap AI combinando: preferenze e cronologia, allineamento prezzo, prossimità/località, sovrapposizione date, categoria/tipo annuncio e segnali di interesse reciproco. I “match perfetti” sono bidirezionali.",
    legendShow: "Mostra spiegazione",
    legendHide: "Nascondi spiegazione",
    legendShowScores: "Mostra spiegazione punteggi",
    legendHideScores: "Nascondi spiegazione punteggi",
    perfectMatches: "Match perfetti",
    perfectSubtitle:
      "Incroci bidirezionali: piaci a loro e loro piacciono a te. 80+ = affinità altissima.",
    compatibleMatches: "Match compatibili",
    compatibleSubtitle:
      "I numeri (60/70/80) sono la percentuale stimata di compatibilità: 60=base, 70=buona, 80+=eccellente.",
    statusQueued: "Ricalcolo AI in coda…",
    statusRunning: "Ricalcolo AI in corso…",
    statusDone: "Ricalcolo completato ✓",
    recomputeAI: "Ricalcola AI",
      matchFound: "Abbiamo trovato un match!",
      noOffers: "Nessuna offerta trovata",
      accept: "Accetta",
      reject: "Rifiuta",
    },

    // --- Auth / Onboarding ---
    auth: {
      loginTitle: "Accedi",
      login: "Accedi",
      email: "Email",
      password: "Password",
      forgot: "Password dimenticata?",
      continueGoogle: "Continua con Google",
      continueFacebook: "Continua con Facebook",
      createAccount: "Crea un nuovo account",
      fillEmailPwd: "Inserisci email e password",
      loginFailed: "Login fallito",
      fillForSignup: "Inserisci email e password per registrarti",
      checkInbox: "Controlla la posta",
      confirmLinkSent: "Ti abbiamo inviato un link di conferma.",
      signupFailed: "Registrazione fallita",
      needEmail: "Serve l'email",
      enterEmailForReset:
        "Inserisci la tua email per ricevere il link di reset.",
      emailSent: "Email inviata",
      checkResetLink:
        "Controlla la tua casella per il link di reset.",
      resetError: "Errore reset",
      oauthFailed: "OAuth fallito",
    },

    onboarding: {
      welcomeTitle: "Benvenuto su TravelSwapAI",
      welcomeText: "Scambia viaggi, risparmia e scopri il mondo.",
      hotelTitle: "Crea o trova offerte",
      hotelText:
        "Pubblica un annuncio o cerca tra centinaia di proposte.",
      matchingTitle: "Match con l'AI e parti!",
      matchingText:
        "Trova il match perfetto e parti senza pensieri.",
      skip: "Salta",
      next: "Avanti",
      start: "Inizia",
    },

    // --- Pulsanti & Placeholder (generici) ---
    buttons: {
      login: "Accedi",
      signup: "Registrati",
      forgotPassword: "Password dimenticata?",
      continueGoogle: "Continua con Google",
      continueFacebook: "Continua con Facebook",
      createAccount: "Crea un nuovo account",
      publish: "Pubblica",
      apply: "Applica",
      contactHost: "Contatta host",
      book: "Prenota",
      accept: "Accetta",
      reject: "Rifiuta",
      start: "Inizia",
      skip: "Salta",
      finish: "Fine",
      updateProfile: "Aggiorna profilo",
      logout: "Esci",
      aiMagic: "Magia AI ✨",
    },

    placeholders: {
      email: "Email",
      password: "Password",
      name: "Nome",
      surname: "Cognome",
      search: "Cerca…",
      title: "Titolo",
      description: "Descrizione",
      price: "Prezzo",
      pnr: "PNR",
    },

    // --- Errori globali (usati da ProfileScreen) ---
    errors: {
      loadMyListings: "Impossibile caricare i tuoi annunci",
      updateStatus: "Impossibile aggiornare lo stato",
      delete: "Impossibile eliminare",
      logout: "Impossibile uscire dall’account.",
      invalidIdTitle: "Anteprima non disponibile",
  invalidIdMsg: "Questo elemento è un esempio (ID non valido). Esegui un ricalcolo o apri un annuncio reale.",
    },

    // --- Stack titles opzionali ---
    stack: {
      offerDetail: "Dettaglio offerta",
      offerFlow: "Nuova offerta",
      matching: "Matching",
      listingDetail: "Dettaglio annuncio",
      editProfile: "Modifica profilo",
      createListing: "Crea annuncio",
      onboarding: "Onboarding",
      login: "Accedi",
    },
  },

  /* ===========================
   * ENGLISH
   * =========================== */
  en: {
    common: {
      yes: "Yes",
      no: "No",
      ok: "OK",
      cancel: "Cancel",
      save: "Save",
      edit: "Edit",
      delete: "Delete",
      back: "Back",
      next: "Next",
      continue: "Continue",
      close: "Close",
      loading: "Loading…",
      error: "Error",
      retry: "Retry",
      confirm: "Confirm",
      clear: "Clear",
      start: "Start",
      skip: "Skip"
    },

    tabs: {
      home: "All",
      offers: "My Offers",
      create: "Create",
      messages: "Messages",
      profile: "My Profile",
    },
listings: {
  filters: {
    all: "All",        // en
    trains: "Trains",
    hotels: "Hotels",
    flights: "Flights",
  },
},
    listingsTitle: "Listings",
    offers: "Offers",
    aiMatching: "My AI Matches",
    home: "Home",
    profile: "Profile",
    receivedOffers: "Received offers",

    profile: {
      title: "Profile",
      editProfile: "Edit profile",
      logout: "Logout",
      myListings: "My listings",
      publishListing: "Publish listing",
      premium: "Go Premium",
      saved: "Profile updated",
    },

    listing: {
      type: { hotel: "Hotel", train: "Train" },
      untitled: "Untitled",
      publishedOn: "Published on",
      filterPrefix: "Filter:",
      showAll: "Show all",

      state: {
        active: "Active",
        swapped: "Swapped",
        sold: "Sold",
        pending: "Pending review",
        expired: "Expired",
      },
      filters: {
        active: "Active",
        swapped: "Swapped",
        sold: "Sold",
        pending: "Pending review",
        expired: "Expired",
      },

      actions: {
        pause: "Pause",
        activate: "Activate",
        deleteTitle: "Delete listing",
        deleteConfirm: "Do you want to delete “{title}”?",
        more: "Actions",
      },

      empty: "You don't have any listings yet",
      emptyForFilter: "No listings for this status",
      tryChangeFilter: "Try changing the filter.",
      usePlus: "Use the + button to create one.",
    },

    createListing: {
      title: "New listing",
      step1: "Main info",
      step2: "Details & publish",

      type: "Type",
      titleLabel: "Title *",
      titlePlaceholderHotel: "e.g. Double room near Duomo",
      titlePlaceholderTrain: "e.g. Milan → Rome (FR 9520)",
      locationLabel: "Location *",
      locationPlaceholderHotel: "e.g. Milan, Navigli",
      locationPlaceholderTrain: "e.g. Milano Centrale → Roma Termini",

      checkIn: "Check-in",
      checkOut: "Check-out",
      departAt: "Departure (date & time)",
      arriveAt: "Arrival (date & time)",

      description: "Description",
      descriptionPlaceholder: "Helpful details for interested people…",
      price: "Price *",
      pricePlaceholder: "e.g. 120",
      imageUrl: "Image URL",
      imageHint: "Add an image URL to preview",
      imageLoadError: "Unable to load image",

      aiImport: "AI Import 1-click",
      aiImportDesc:
        "Automatically import listing data by scanning a QR code or entering a PNR.",
      aiMagic: "AI Magic ✨",
      ai: {
        title: "AI Magic ✨",
        applied:
          "I suggested some fields for this step. You can always edit them.",
        error: "Unable to generate suggestions.",
        hotelTitle: "2-night stay downtown",
        hotelLocation: "Milan, Duomo",
        hotelDesc:
          "Double room with breakfast. Flexible check-in, close to transport.",
        trainTitle: "Frecciarossa Milan → Rome",
        trainLocation: "Milano Centrale → Roma Termini",
        trainDesc:
          "Confirmed seat, quiet coach. Transferable ticket.",
      },

      train: {
        particulars: "Train specifics",
        namedTicket: "Named ticket",
        genderNote:
          "If enabled, specify the gender shown on the ticket.",
        genderLabel: "Gender *",
        pnrLabel: "PNR (optional)",
        pnrPlaceholder: "e.g. ABCDEF",
        pnrPrivacy: "The PNR will not be visible in the listing.",
      },

      orEnterPnr: "Or enter PNR",
      importFromPnr: "Import from PNR",
      pnrMissingTitle: "Missing PNR",
      pnrMissingMsg: "Enter a PNR or ticket code.",

      scanQr: "Scan QR",
      scanQrUnavailable: "Scan QR (unavailable)",
      qrPromptTitle: "Frame the ticket QR",
      scannerUnavailable: "Scanner unavailable",
      scannerUnavailableTitle: "Scanner unavailable",
      scannerUnavailableMsg:
        "Camera module not present. Use PNR input.",
      cameraDeniedTitle: "Permission denied",
      cameraDeniedMsg:
        "Allow camera access to use the scanner.",
      cameraRequestError:
        "Unable to request camera permission.",
      aiImportSuccess: "Data imported successfully.",
      aiImportError: "Unable to import from PNR.",
      aiImportFromQr: "Data imported from QR.",
      qrImportError: "QR import failed.",
      simulateScan: "Simulate scan",

      saveDraft: "Save draft",
      publishedTitle: "Published 🎉",
      publishedMsg:
        "Your listing has been published successfully.",
      publish: "Publish",
      publishError:
        "Unable to publish the listing.",
      draftSavedTitle: "Draft saved",
      draftSavedMsg: "You can resume it anytime.",
      draftSaveError: "Couldn't save the draft.",

      pickTime: "Pick time",

      errors: {
        titleRequired: "Title is required.",
        locationRequired: "Location is required.",
        checkInRequired: "Check-in is required.",
        checkOutRequired: "Check-out is required.",
        checkInInvalid: "Invalid check-in (YYYY-MM-DD).",
        checkOutInvalid: "Invalid check-out (YYYY-MM-DD).",
        checkoutBeforeCheckin:
          "Check-out cannot be before check-in.",
        departRequired: "Departure date/time is required.",
        arriveRequired: "Arrival date/time is required.",
        departInvalid:
          "Invalid departure (YYYY-MM-DD HH:mm).",
        arriveInvalid:
          "Invalid arrival (YYYY-MM-DD HH:mm).",
        arriveBeforeDepart:
          "Arrival cannot be before departure.",
        genderRequired: "Select M or F.",
        priceRequired: "Price is required.",
        priceInvalid: "Invalid price.",
      },
    },

    offers: {
      title: "Offers",
      accept: "Accept",
      decline: "Decline",
      cancel: "Cancel",
      accepted: "Proposal accepted",
      declined: "Proposal declined",
      canceled: "Proposal canceled",
      buy: "Purchase",
      swap: "Swap",
      for: "For",
      from: "From",
      to: "To",
      user: "user",
      offered: "Offered",
      amount: "Amount",
      proposals: "Proposals",
      incoming: "Received",
      outgoing: "Sent",
      none: "No proposals",
      receivedOffers: "Received offers",
      sentOffers: "Sent offers",
      proposePurchase: "Propose purchase",   // EN
      proposeSwap: "Propose swap",           // EN
    },

    offerDetail: {
      title: "Offer detail",
      proposals: "Proposal detail",
      listing: "Listing",
      notFound: "Listing not found.",
      buyProposal: "Purchase proposal",
      swapProposal: "Swap proposal",
      from: "From",
      fromUser: "From",
      to: "to",
      offerAmount: "Offer",
      description: "Description",
      price: "Price",
      contact: "Contact host",
      book: "Book",
    },

    offerFlow: {
      title: "New offer",
      stepDestination: "Choose destination",
      stepDates: "Select dates",
      stepConfirm: "Confirm",
      next: "Next",
      back: "Back",
      confirm: "Confirm",
    },

    listingDetail: {
      title: "Listing detail",
      description: "Description",
      price: "Price",
    },

    matching: {
      title: "Matching",
       pill: { new: "New" },
    legend: {
      title: "What do 60 / 70 / 80 mean?",
      base: "60–69 = basic compatibility",
      good: "70–79 = good compatibility",
      excellent: "80–100 = excellent affinity",
      long:
        "The score is an estimate (0–100) calculated by TravelSwap AI by combining: preferences and history, price alignment, proximity/location, date overlap, listing category/type, and signals of mutual interest. “Perfect matches” are bidirectional.",
      show: "Show explanation",
      hide: "Hide explanation",
      showA11y: "Show score explanation",
      hideA11y: "Hide score explanation",
    },
    status: {
      queued: "AI recompute queued…",
      running: "AI recompute in progress…",
      done: "Recompute completed ✓",
    },
    sections: {
      perfectTitle: "Perfect matches",
      perfectSubtitle:
        "Bidirectional matches: you like them and they like you. 80+ = very high affinity.",
      compatibleTitle: "Compatible matches",
      compatibleSubtitle:
        "The numbers (60/70/80) are the estimated compatibility percentage: 60=basic, 70=good, 80+=excellent.",
    },
    list: { empty: "No results." },
    fab: { recompute: "Recompute AI" },
    toasts: { queued: "AI recompute queued…", done: "Recompute completed ✓" },
      matchFound: "We found a match!",
      noOffers: "No offers found",
      accept: "Accept",
      reject: "Decline",
    },

    auth: {
      loginTitle: "Log in",
      login: "Log in",
      email: "Email",
      password: "Password",
      forgot: "Forgot password?",
      continueGoogle: "Continue with Google",
      continueFacebook: "Continue with Facebook",
      createAccount: "Create a new account",
      fillEmailPwd: "Enter email and password",
      loginFailed: "Login failed",
      fillForSignup:
        "Enter email and password to sign up",
      checkInbox: "Check your inbox",
      confirmLinkSent:
        "We've sent you a confirmation link.",
      signupFailed: "Signup failed",
      needEmail: "Email required",
      enterEmailForReset:
        "Enter your email to receive the reset link.",
      emailSent: "Email sent",
      checkResetLink:
        "Check your inbox for the reset link.",
      resetError: "Reset error",
      oauthFailed: "OAuth failed",
    },

    onboarding: {
      title1: "Welcome to TravelSwapAI",
      text1: "Swap trips, save money, and explore the world.",
      title2: "Create or find offers",
      text2: "Post a listing or browse hundreds of deals.",
      title3: "Match and go",
      text3:
        "Find the perfect match and travel carefree.",
      skip: "Skip",
      next: "Next",
      start: "Start",
    },

    buttons: {
      login: "Log in",
      signup: "Sign up",
      forgotPassword: "Forgot password?",
      continueGoogle: "Continue with Google",
      continueFacebook: "Continue with Facebook",
      createAccount: "Create a new account",
      publish: "Publish",
      apply: "Apply",
      contactHost: "Contact host",
      book: "Book",
      accept: "Accept",
      reject: "Decline",
      start: "Start",
      skip: "Skip",
      finish: "Finish",
      updateProfile: "Update profile",
      logout: "Logout",
      aiMagic: "AI Magic ✨",
    },

    placeholders: {
      email: "Email",
      password: "Password",
      name: "Name",
      surname: "Surname",
      search: "Search…",
      title: "Title",
      description: "Description",
      price: "Price",
      pnr: "PNR",
    },

    errors: {
      loadMyListings: "Unable to load your listings",
      updateStatus: "Unable to update status",
      delete: "Unable to delete",
      logout: "Unable to sign out.",
      invalidIdTitle: "Preview not available",
  invalidIdMsg: "This item is a sample (invalid ID). Recompute or open a real listing.",
    },

    stack: {
      offerDetail: "Offer detail",
      offerFlow: "New offer",
      matching: "Matching",
      listingDetail: "Listing detail",
      editProfile: "Edit profile",
      createListing: "Create listing",
      onboarding: "Onboarding",
      login: "Log in",
    },
  },

  /* ===========================
   * ESPAÑOL
   * =========================== */
  es: {
    common: {
      yes: "Sí",
      no: "No",
      ok: "OK",
      cancel: "Cancelar",
      save: "Guardar",
      edit: "Editar",
      delete: "Eliminar",
      back: "Atrás",
      next: "Siguiente",
      continue: "Continuar",
      close: "Cerrar",
      loading: "Cargando…",
      error: "Error",
      retry: "Reintentar",
      confirm: "Confirmar",
      clear: "Limpiar",
      start: "come si dice in sp",
      skip: "come si dice"

    },

    tabs: {
      home: "Todas",
      offers: "Mis ofertas",
      create: "Crear",
      messages: "Mensajes",
      profile: "Perfil",
    },
    
listings: {
  filters: {
    all: "Todos",      // es
    trains: "Trenes",
    hotels: "Hoteles",
    flights: "Vuelos",
  },
},
    listingsTitle: "Anuncios",
    offers: "Ofertas",
    aiMatching: "AI Matching",
    home: "Inicio",
    profile: "Perfil",
    receivedOffers: "Ofertas recibidas",

    profile: {
      title: "Perfil",
      editProfile: "Editar perfil",
      logout: "Cerrar sesión",
      myListings: "Mis anuncios",
      publishListing: "Publicar anuncio",
      premium: "Hazte Premium",
      saved: "Perfil actualizado",
    },

    listing: {
      type: { hotel: "Hotel", train: "Tren" },
      untitled: "Sin título",
      publishedOn: "Publicado el",
      filterPrefix: "Filtro:",
      showAll: "Mostrar todos",

      state: {
        active: "Activo",
        swapped: "Intercambiado",
        sold: "Vendido",
        pending: "En revisión",
        expired: "Caducado",
      },
      filters: {
        active: "Activos",
        swapped: "Intercambiados",
        sold: "Vendidos",
        pending: "En revisión",
        expired: "Caducados",
      },

      actions: {
        pause: "Pausar",
        activate: "Activar",
        deleteTitle: "Eliminar anuncio",
        deleteConfirm: "¿Quieres eliminar “{title}”?",
        more: "Acciones",
      },

      empty: "Aún no tienes anuncios",
      emptyForFilter: "No hay anuncios para este estado",
      tryChangeFilter: "Prueba a cambiar el filtro.",
      usePlus: "Usa el botón + para crear uno.",
    },

    createListing: {
      title: "Nuevo anuncio",
      step1: "Datos principales",
      step2: "Detalles y publicación",

      type: "Tipo",
      cercoVendoLabel: "Tipo annuncio",
      cerco: "Cerco",
      vendo: "Vendo",
      titleLabel: "Título *",
      titlePlaceholderHotel: "Ej. Habitación doble cerca del Duomo",
      titlePlaceholderTrain: "Ej. Milán → Roma (FR 9520)",
      locationLabel: "Localidad *",
      locationPlaceholderHotel: "Ej. Milán, Navigli",
      locationPlaceholderTrain: "Ej. Milano Centrale → Roma Termini",

      checkIn: "Check-in",
      checkOut: "Check-out",
      departAt: "Salida (fecha y hora)",
      arriveAt: "Llegada (fecha y hora)",

      description: "Descripción",
      descriptionPlaceholder: "Detalles útiles para los interesados…",
      price: "Precio *",
      pricePlaceholder: "Ej. 120",
      imageUrl: "URL de la imagen",
      imageHint: "Añade una URL de imagen para previsualizar",
      imageLoadError: "No se puede cargar la imagen",

      aiImport: "AI Import 1-click",
      aiImportDesc:
        "Importa automáticamente los datos del anuncio escaneando un QR o introduciendo un PNR.",
      aiMagic: "Magia IA ✨",
      ai: {
        title: "Magia IA ✨",
        applied:
          "He sugerido algunos campos para este paso. Siempre puedes editarlos.",
        error: "No se pueden generar sugerencias.",
        hotelTitle: "Estancia de 2 noches en el centro",
        hotelLocation: "Milán, Duomo",
        hotelDesc:
          "Habitación doble con desayuno. Check-in flexible, cerca del transporte.",
        trainTitle: "Frecciarossa Milán → Roma",
        trainLocation: "Milano Centrale → Roma Termini",
        trainDesc:
          "Asiento confirmado, vagón silencioso. Billete transferible.",
      },

      train: {
        particulars: "Datos particulares del tren",
        namedTicket: "Billete nominativo",
        genderNote:
          "Si está activo, indica el género que aparece en el billete.",
        genderLabel: "Género *",
        pnrLabel: "PNR (opcional)",
        pnrPlaceholder: "Ej. ABCDEF",
        pnrPrivacy:
          "El PNR no será visible en el anuncio.",
      },

      orEnterPnr: "O introduce PNR",
      importFromPnr: "Importar desde PNR",
      pnrMissingTitle: "PNR faltante",
      pnrMissingMsg:
        "Introduce un código PNR o de billete.",

      scanQr: "Escanear QR",
      scanQrUnavailable: "Escanear QR (no disponible)",
      qrPromptTitle: "Enfoca el QR del billete",
      scannerUnavailable: "Escáner no disponible",
      scannerUnavailableTitle: "Escáner no disponible",
      scannerUnavailableMsg:
        "Módulo de cámara no presente. Usa la entrada de PNR.",
      cameraDeniedTitle: "Permiso denegado",
      cameraDeniedMsg:
        "Permite acceso a la cámara para usar el escáner.",
      cameraRequestError:
        "No se pueden solicitar permisos de cámara.",
      aiImportSuccess: "Datos importados correctamente.",
      aiImportError:
        "No se puede importar desde el PNR.",
      aiImportFromQr: "Datos importados desde el QR.",
      qrImportError: "Fallo al importar desde QR.",
      simulateScan: "Simular escaneo",

      saveDraft: "Guardar borrador",
      publishedTitle: "Publicado 🎉",
      publishedMsg:
        "Tu anuncio se ha publicado correctamente.",
      publish: "Publicar",
      publishError:
        "No se puede publicar el anuncio.",
      draftSavedTitle: "Borrador guardado",
      draftSavedMsg:
        "Puedes retomarlo en cualquier momento.",
      draftSaveError:
        "No he podido guardar el borrador.",

      pickTime: "Elegir hora",

      errors: {
        titleRequired: "Título obligatorio.",
        locationRequired: "Localidad obligatoria.",
        checkInRequired: "Check-in obligatorio.",
        checkOutRequired: "Check-out obligatorio.",
        checkInInvalid:
          "Check-in no válido (YYYY-MM-DD).",
        checkOutInvalid:
          "Check-out no válido (YYYY-MM-DD).",
        checkoutBeforeCheckin:
          "El check-out no puede ser antes del check-in.",
        departRequired:
          "Fecha/hora de salida obligatoria.",
        arriveRequired:
          "Fecha/hora de llegada obligatoria.",
        departInvalid:
          "Salida no válida (YYYY-MM-DD HH:mm).",
        arriveInvalid:
          "Llegada no válida (YYYY-MM-DD HH:mm).",
        arriveBeforeDepart:
          "La llegada no puede ser antes de la salida.",
        genderRequired: "Selecciona M o F.",
        priceRequired: "Precio obligatorio.",
        priceInvalid: "Precio no válido.",
      },
    },

    offers: {
      title: "Ofertas",
      accept: "Aceptar",
      decline: "Rechazar",
      cancel: "Cancelar",
      accepted: "Propuesta aceptada",
      declined: "Propuesta rechazada",
      canceled: "Propuesta cancelada",
      buy: "Compra",
      swap: "Intercambio",
      for: "Para",
      from: "De",
      to: "A",
      user: "usuario",
      offered: "Ofrecido",
      amount: "Importe",
      proposals: "Propuestas",
      incoming: "Recibidas",
      outgoing: "Enviadas",
      none: "No hay propuestas",
      receivedOffers: "Ofertas recibidas",
      sentOffers: "Ofertas enviadas",
      proposePurchase: "Proponer compra",    // ES
      proposeSwap: "Proponer intercambio",   // ES
    },

    offerDetail: {
      title: "Detalle de la oferta",
      proposals: "Detalle de propuestas",
      listing: "Anuncio",
      notFound: "Anuncio no encontrado.",
      buyProposal: "Propuesta de compra",
      swapProposal: "Propuesta de intercambio",
      from: "De",
      fromUser: "De",
      to: "para",
      offerAmount: "Oferta",
      description: "Descripción",
      price: "Precio",
      contact: "Contactar anfitrión",
      book: "Reservar",
    },

    offerFlow: {
      title: "Nueva oferta",
      stepDestination: "Elige destino",
      stepDates: "Selecciona fechas",
      stepConfirm: "Confirmar",
      next: "Siguiente",
      back: "Atrás",
      confirm: "Confirmar",
    },

    listingDetail: {
      title: "Detalle del anuncio",
      description: "Descripción",
      price: "Precio",
    },

    matching: {
      title: "Matching",
     pill: { new: "Nuevo" },
    legend: {
      title: "¿Qué significan 60 / 70 / 80?",
      base: "60–69 = compatibilidad básica",
      good: "70–79 = buena compatibilidad",
      excellent: "80–100 = afinidad excelente",
      long:
        "La puntuación es una estimación (0–100) calculada por TravelSwap AI combinando: preferencias e historial, alineación de precios, proximidad/ubicación, solapamiento de fechas, categoría/tipo de anuncio y señales de interés mutuo. Las “coincidencias perfectas” son bidireccionales.",
      show: "Mostrar explicación",
      hide: "Ocultar explicación",
      showA11y: "Mostrar explicación de puntajes",
      hideA11y: "Ocultar explicación de puntajes",
    },
    status: {
      queued: "Recalculo de AI en cola…",
      running: "Recalculo de AI en curso…",
      done: "Recalculo completado ✓",
    },
    sections: {
      perfectTitle: "Coincidencias perfectas",
      perfectSubtitle:
        "Cruces bidireccionales: te gustan y tú les gustas a ellos. 80+ = afinidad muy alta.",
      compatibleTitle: "Coincidencias compatibles",
      compatibleSubtitle:
        "Los números (60/70/80) son el porcentaje estimado de compatibilidad: 60=básica, 70=buena, 80+=excelente.",
    },
    list: { empty: "Sin resultados." },
    fab: { recompute: "Recalcular AI" },
    toasts: { queued: "Recalculo de AI en cola…", done: "Recalculo completado ✓" },
      matchFound: "¡Hemos encontrado un match!",
      noOffers: "No se encontraron ofertas",
      accept: "Aceptar",
      reject: "Rechazar",
    },

    auth: {
      loginTitle: "Iniciar sesión",
      login: "Iniciar sesión",
      email: "Correo electrónico",
      password: "Contraseña",
      forgot: "¿Olvidaste la contraseña?",
      continueGoogle: "Continuar con Google",
      continueFacebook: "Continuar con Facebook",
      createAccount: "Crear una cuenta nueva",
      fillEmailPwd:
        "Introduce correo y contraseña",
      loginFailed: "Error de inicio de sesión",
      fillForSignup:
        "Introduce correo y contraseña para registrarte",
      checkInbox: "Revisa tu correo",
      confirmLinkSent:
        "Te hemos enviado un enlace de confirmación.",
      signupFailed: "Registro fallido",
      needEmail: "Se requiere correo",
      enterEmailForReset:
        "Introduce tu correo para recibir el enlace de restablecimiento.",
      emailSent: "Correo enviado",
      checkResetLink:
        "Revisa tu bandeja por el enlace de restablecimiento.",
      resetError: "Error de restablecimiento",
      oauthFailed: "OAuth fallido",
    },

    onboarding: {
      title1: "Bienvenido a TravelSwapAI",
      text1: "Intercambia viajes, ahorra y explora el mundo.",
      title2: "Crea o encuentra ofertas",
      text2:
        "Publica un anuncio o navega entre cientos de propuestas.",
      title3: "Match y a viajar",
      text3:
        "Encuentra el match perfecto y viaja sin preocupaciones.",
      skip: "Saltar",
      next: "Siguiente",
      start: "Empezar",
    },

    buttons: {
      login: "Iniciar sesión",
      signup: "Registrarse",
      forgotPassword: "¿Olvidaste la contraseña?",
      continueGoogle: "Continuar con Google",
      continueFacebook: "Continuar con Facebook",
      createAccount: "Crear una cuenta nueva",
      publish: "Publicar",
      apply: "Aplicar",
      contactHost: "Contactar anfitrión",
      book: "Reservar",
      accept: "Aceptar",
      reject: "Rechazar",
      start: "Empezar",
      skip: "Saltar",
      finish: "Finalizar",
      updateProfile: "Actualizar perfil",
      logout: "Cerrar sesión",
      aiMagic: "Magia IA ✨",
    },

    placeholders: {
      email: "Correo electrónico",
      password: "Contraseña",
      name: "Nombre",
      surname: "Apellido",
      search: "Buscar…",
      title: "Título",
      description: "Descripción",
      price: "Precio",
      pnr: "PNR",
    },

    errors: {
      loadMyListings: "No se pueden cargar tus anuncios",
      updateStatus: "No se puede actualizar el estado",
      delete: "No se puede eliminar",
      logout: "No se puede cerrar la sesión.",
        invalidIdTitle: "Vista previa no disponible",
  invalidIdMsg: "Este elemento es un ejemplo (ID no válido). Recalcula o abre un anuncio real.",
    },

    stack: {
      offerDetail: "Detalle de la oferta",
      offerFlow: "Nueva oferta",
      matching: "Matching",
      listingDetail: "Detalle del anuncio",
      editProfile: "Editar perfil",
      createListing: "Crear anuncio",
      onboarding: "Onboarding",
      login: "Iniciar sesión",
    },
  },
};
