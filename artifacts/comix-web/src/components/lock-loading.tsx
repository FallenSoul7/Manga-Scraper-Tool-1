export function LockLoading() {
  return (
    <div className="lock-loading" role="status" aria-label="Opening ComiHub">
      <div className="lock-loading__panel" aria-hidden="true">
        <div className="lock-loading__halftone" />
        <div className="lock-loading__speed-lines lock-loading__speed-lines--left" />
        <div className="lock-loading__speed-lines lock-loading__speed-lines--right" />

        <div className="lock-loading__logo">
          <span>Comi</span>
          <strong>Hub</strong>
        </div>
        <div className="lock-loading__caption">YOUR NEXT CHAPTER</div>

        <div className="lock-loading__speech-bubble">
          <span>HEY!</span>
          <i />
        </div>

        <svg
          className="lock-loading__character"
          viewBox="0 0 220 230"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M54 230C57 185 75 160 110 158C145 160 163 185 166 230H54Z"
            fill="hsl(var(--primary))"
          />
          <path
            d="M73 230C78 195 89 178 110 177C131 178 142 195 147 230H73Z"
            fill="hsl(var(--primary-foreground))"
            fillOpacity=".14"
          />
          <path
            d="M71 91C71 65 87 43 110 43C133 43 149 65 149 91V111C149 138 132 155 110 155C88 155 71 138 71 111V91Z"
            fill="#FFD4C2"
          />
          <path
            d="M70 91C68 63 84 35 112 35C139 35 153 57 150 91C141 80 132 70 122 59C111 75 93 85 70 91Z"
            fill="#20255F"
          />
          <path
            d="M78 61C88 42 103 35 119 38C132 40 143 50 148 64C133 56 117 55 101 62C92 66 85 72 78 80V61Z"
            fill="#30368A"
          />
          <path
            d="M91 105C95 108 99 109 103 109"
            stroke="#9A4F58"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M128 105C124 108 120 109 116 109"
            stroke="#9A4F58"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M96 127C104 133 116 133 124 127"
            stroke="#D36B72"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M86 161C67 168 52 184 45 205"
            stroke="#FFD4C2"
            strokeWidth="17"
            strokeLinecap="round"
          />
          <path
            d="M134 161C153 168 166 181 176 195"
            stroke="#FFD4C2"
            strokeWidth="17"
            strokeLinecap="round"
          />
          <g className="lock-loading__waving-hand">
            <path
              d="M174 198C167 190 166 181 171 175C176 170 181 173 183 179L186 165C187 159 191 157 195 160C198 162 197 167 196 172L198 161C199 155 203 154 207 157C210 159 209 164 208 170L210 163C211 158 216 158 218 162C220 166 217 177 214 185C210 197 201 207 192 209C185 210 179 204 174 198Z"
              fill="#FFD4C2"
            />
            <path
              d="M187 184C192 187 198 187 204 183"
              stroke="#D99589"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
          <path
            d="M91 171C98 179 122 179 129 171"
            stroke="#FF8A91"
            strokeWidth="4"
            strokeLinecap="round"
            opacity=".75"
          />
        </svg>

        <div className="lock-loading__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="lock-loading__progress">
          <span />
        </div>
      </div>
      <span className="sr-only">Opening ComiHub securely…</span>
    </div>
  );
}