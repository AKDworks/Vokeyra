export function setupInfoTooltips(): void {
  let active: { button: HTMLButtonElement; tooltip: HTMLDivElement } | undefined;

  const hide = () => {
    if (active) active.tooltip.hidden = true;
    active = undefined;
  };

  document.querySelectorAll<HTMLButtonElement>('button[data-help]').forEach((button, index) => {
    const tooltip = document.createElement('div');
    tooltip.id = `info-tooltip-${index}`;
    tooltip.className = 'info-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.textContent = button.dataset.help!;
    tooltip.hidden = true;
    document.body.append(tooltip);
    button.setAttribute('aria-describedby', tooltip.id);

    const show = () => {
      hide();
      if (button.disabled) return;
      active = { button, tooltip };
      tooltip.hidden = false;
      const anchor = button.getBoundingClientRect();
      const bounds = tooltip.getBoundingClientRect();
      const left = Math.max(12, Math.min(anchor.x + anchor.width / 2 - bounds.width / 2, window.innerWidth - bounds.width - 12));
      const above = anchor.top - bounds.height - 9 >= 8;
      const top = above ? anchor.top - bounds.height - 9 : anchor.bottom + 9;
      tooltip.dataset.side = above ? 'above' : 'below';
      tooltip.style.setProperty('--arrow-x', `${anchor.x + anchor.width / 2 - left}px`);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };
    button.addEventListener('mouseenter', show);
    button.addEventListener('mouseleave', hide);
    button.addEventListener('focus', () => { if (button.matches(':focus-visible')) show(); });
    button.addEventListener('blur', hide);
    button.addEventListener('click', show);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hide();
  });
  document.addEventListener('pointerdown', event => {
    if (active && !active.button.contains(event.target as Node) && !active.tooltip.contains(event.target as Node)) hide();
  });
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
}
