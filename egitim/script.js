(function () {
  'use strict';

  const STORAGE_KEY = 'egitim-theme';

  // --- Theme ---
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
    if (themeIcon) {
      themeIcon.textContent = theme === 'dark' ? '\u2600' : '\uD83C\uDF19';
    }
    if (themeToggle) {
      themeToggle.setAttribute('aria-label', theme === 'dark' ? 'A\u00E7\u0131k temaya ge\u00E7' : 'Koyu temaya ge\u00E7');
    }
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    setTheme(current === 'dark' ? 'light' : 'dark');
  }

  // Load saved theme
  const savedTheme = localStorage.getItem(STORAGE_KEY) || 'light';
  setTheme(savedTheme);

  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  // --- Mobile sidebar ---
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  if (mobileMenuBtn && sidebar && overlay) {
    function openSidebar() {
      sidebar.classList.add('open');
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }

    mobileMenuBtn.addEventListener('click', function () {
      if (sidebar.classList.contains('open')) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });

    overlay.addEventListener('click', closeSidebar);

    // Close sidebar on nav link click (mobile)
    sidebar.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeSidebar);
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sidebar.classList.contains('open')) {
        closeSidebar();
      }
    });
  }

  // --- Scroll spy (IntersectionObserver) ---
  const sections = document.querySelectorAll('.main section');
  const navLinks = document.querySelectorAll('.sidebar nav a');

  if (sections.length > 0 && navLinks.length > 0) {
    const observer = new IntersectionObserver(function (entries) {
      let activeId = null;
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          activeId = entry.target.getAttribute('id');
        }
      });

      if (activeId) {
        navLinks.forEach(function (link) {
          link.classList.remove('active');
          if (link.getAttribute('href') === '#' + activeId) {
            link.classList.add('active');
          }
        });
      }
    }, {
      rootMargin: '-80px 0px -50% 0px',
      threshold: 0
    });

    sections.forEach(function (section) {
      observer.observe(section);
    });

    // Set initial active (first section visible on load)
    setTimeout(function () {
      const firstVisible = document.querySelector('.main section:first-child');
      if (firstVisible) {
        const id = firstVisible.getAttribute('id');
        navLinks.forEach(function (link) {
          if (link.getAttribute('href') === '#' + id) {
            link.classList.add('active');
          }
        });
      }
    }, 100);
  }

  // --- Back to top ---
  const backToTop = document.getElementById('back-to-top');

  if (backToTop) {
    window.addEventListener('scroll', function () {
      if (window.scrollY > 300) {
        backToTop.classList.add('visible');
      } else {
        backToTop.classList.remove('visible');
      }
    });

    backToTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

})();
