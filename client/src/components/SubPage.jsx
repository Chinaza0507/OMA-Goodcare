import { Link } from 'react-router-dom'

// Header for pages opened from Profile: the back button sits at the left side of the page,
// the title and content stay in a centred column.
export default function SubPage({ title, back = '/profile', backLabel, children }) {
  return (
    <div className="relative w-full">
      <Link to={back} aria-label={backLabel} className="absolute left-0 top-0 flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-white text-ink no-underline hover:bg-blush">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
      </Link>
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <div className="flex min-h-11 items-center justify-center px-12">
          <h1 className="m-0 text-center text-2xl font-extrabold">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  )
}
