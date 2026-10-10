// sessionStorage key shared by client components that hold the admin token
// (SessionDeleteButton, /new page). Tab-scoped by design — never localStorage.
export const ADMIN_KEY = "memory-hub:admin-token";