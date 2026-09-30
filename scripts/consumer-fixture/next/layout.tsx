import * as React from "react";

/** The root layout App Router requires; a server component. */
export default function RootLayout({children}: {children: React.ReactNode}): React.ReactElement {
    return <html lang="en"><body>{children}</body></html>;
}
