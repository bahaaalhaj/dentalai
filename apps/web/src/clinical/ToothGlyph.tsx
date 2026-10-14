export function ToothGlyph({
  code,
  pending,
  unknown,
  codes,
}: {
  code: string;
  pending: boolean;
  unknown: boolean;
  codes: string[];
}) {
  const position = Number(code[1]),
    upper = ['1', '2', '5', '6'].includes(code[0]!);
  const shape =
    position >= 6 || (['5', '6', '7', '8'].includes(code[0]!) && position >= 4)
      ? 'M8 9C6 3 13 2 17 5C21 2 28 3 27 10L26 22C26 27 29 36 25 42C22 46 21 34 18 29C15 34 15 46 11 42C7 37 10 27 8 22Z'
      : position >= 4
        ? 'M9 9C8 3 25 3 25 9L24 23C23 29 24 39 19 44C17 46 16 34 14 29C12 40 9 43 10 33Z'
        : 'M10 5Q17 2 24 5L23 22Q21 34 18 44Q13 37 11 23Z';
  return (
    <svg className="tooth-glyph" viewBox="0 0 36 50" aria-hidden="true" focusable="false">
      <g transform={upper ? 'rotate(180 18 25)' : undefined}>
        <path
          d={shape}
          fill={pending ? '#fff4d9' : unknown ? '#f4f6f9' : '#fff'}
          stroke={pending ? '#ac7824' : '#8291a9'}
          strokeWidth="1.6"
          strokeDasharray={unknown ? '2 2' : undefined}
        />
        {pending && (
          <path d="M11 11L23 21M10 17L23 27M12 25L22 35" stroke="#be942d" strokeWidth="1.2" />
        )}
        {codes.includes('caries') && <circle cx="18" cy="14" r="4" fill="#d34d5c" />}
        {codes.includes('restoration') && (
          <rect x="12" y="8" width="12" height="7" rx="2" fill="#627bc6" />
        )}
        {codes.includes('root_canal') && <path d="M18 13L17 35" stroke="#ae693e" strokeWidth="3" />}
        {codes.includes('crown') && (
          <path d="M10 9Q18 3 25 9L24 17L11 17Z" fill="#c6cfdd" stroke="#66758c" />
        )}
        {codes.includes('implant') && (
          <path
            d="M18 18L18 40M13 23L23 23M13 29L23 29M14 35L22 35"
            stroke="#657793"
            strokeWidth="2"
          />
        )}
        {codes.some((value) => value === 'missing' || value === 'extraction') && (
          <path d="M8 8L28 42M28 8L8 42" stroke="#8d5b72" strokeWidth="2" />
        )}
        {codes.includes('fracture') && (
          <path d="M19 7L14 16L21 22L16 30" stroke="#c17439" strokeWidth="2" />
        )}
        {codes.includes('periapical_lesion') && (
          <circle cx="18" cy="40" r="4" fill="none" stroke="#b55168" strokeWidth="2" />
        )}
        {codes.includes('healthy') && (
          <path d="M13 15L17 19L23 12" fill="none" stroke="#2b8b75" strokeWidth="2.5" />
        )}
      </g>
      {unknown && (
        <text x="18" y="27" textAnchor="middle" fill="#65758d" fontSize="13">
          ?
        </text>
      )}
    </svg>
  );
}
