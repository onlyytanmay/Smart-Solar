/* Landing page: Three.js rooftop scene, GSAP intro, counters, scroll reveals. */
(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Three.js rooftop solar scene ---------- */
  const canvas = document.getElementById('hero-3d');
  if (canvas && window.THREE) {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 2.8, 8);
    camera.lookAt(0, 0.3, 0);

    const group = new THREE.Group();
    scene.add(group);

    // Rooftop slab
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(5.4, 0.25, 3.6),
      new THREE.MeshStandardMaterial({ color: 0x1b2d44, roughness: 0.8 })
    );
    roof.position.y = -0.15;
    group.add(roof);

    // 3x2 solar panel array with metal frames
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x12365a, metalness: 0.8, roughness: 0.25, emissive: 0x0a2a3f });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x9bafc3, metalness: 0.9, roughness: 0.3 });
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const panel = new THREE.Group();
        const frame = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.06, 1.01), frameMat);
        const glass = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.07, 0.95), panelMat);
        panel.add(frame, glass);
        panel.position.set(-1.5 + c * 1.5, 0.35, -0.7 + r * 1.4);
        panel.rotation.x = -0.5;
        group.add(panel);
      }
    }

    // Sun and lighting
    const sun = new THREE.Mesh(new THREE.SphereGeometry(0.7, 32, 32), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
    sun.position.set(4, 3.4, -2.5);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0x42c8ff, 1.2);
    key.position.set(3, 5, 4);
    scene.add(key);

    // Floating energy particles
    const count = 180;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < positions.length; i++) positions[i] = (Math.random() - 0.5) * 12;
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particles = new THREE.Points(
      particleGeo,
      new THREE.PointsMaterial({ color: 0x42e8a5, size: 0.04, transparent: true, opacity: 0.7 })
    );
    scene.add(particles);

    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    // Pointer influence: the array eases toward the cursor
    let targetX = 0, targetY = 0;
    window.addEventListener('mousemove', (e) => {
      targetX = e.clientX / window.innerWidth - 0.5;
      targetY = e.clientY / window.innerHeight - 0.5;
    });

    const render = (t) => {
      group.rotation.y += (targetX * 0.9 - group.rotation.y) * 0.05;
      group.rotation.x += (targetY * 0.3 - group.rotation.x) * 0.05;
      group.position.y = Math.sin(t / 1200) * 0.08;
      sun.scale.setScalar(1 + Math.sin(t / 700) * 0.04);
      particles.rotation.y += 0.0008;
      renderer.render(scene, camera);
      if (!reduceMotion) requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  /* ---------- GSAP intro ---------- */
  if (window.gsap && !reduceMotion) {
    gsap.from('.hero-copy > *', { y: 30, opacity: 0, stagger: 0.12, duration: 0.9, ease: 'power3.out' });
    gsap.from('.nav-glass', { y: -30, opacity: 0, duration: 0.8, ease: 'power3.out' });
  }

  /* ---------- Scroll reveals ---------- */
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
          const counter = entry.target.querySelector('[data-count]');
          if (counter) countUp(counter);
        }
      });
    }, { threshold: 0.2 });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('visible'));
  }

  /* ---------- Animated counters ---------- */
  function countUp(el) {
    const target = Number(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    if (reduceMotion) { el.textContent = target.toLocaleString('en-IN') + suffix; return; }
    const start = performance.now(), duration = 1600;
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString('en-IN') + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Bars in the dashboard preview grow to their target height
  document.querySelectorAll('.bars span').forEach((bar, i) => {
    bar.style.transitionDelay = `${i * 60}ms`;
  });
})();
