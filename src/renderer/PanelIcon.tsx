const paths = {
  mic: 'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V5M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8',
  board: 'M14 4l6 6M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z',
  expand: 'm7 14 5-5 5 5',
  collapse: 'm7 10 5 5 5-5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'm6 6 12 12M6 18 18 6',
  send: 'M12 20V4m-6 6 6-6 6 6',
};
export function PanelIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
