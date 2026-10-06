import { requestJSON as accountRequest } from "./request.js";
export function profilePanel() {
  return {
    phone: "",
    newPhone: "",
    phoneSecret: "",
    phoneSaved: false,
    currentSecret: "",
    secret: "",
    confirmSecret: "",
    profileError: "",
    profileBusy: false,
    profileLoaded: false,
    passwordSaved: false,
    async loadProfile() {
      if (this.profileLoaded || this.profileBusy) return;
      this.profileBusy = true;
      this.profileError = "";
      try {
        const d = await accountRequest("/account/buildings");
        if (!d.linked)
          throw Error("Tu sesión terminó. Vuelve a iniciar sesión.");
        this.phone = d.phone || "Sin teléfono asignado";
        this.profileLoaded = true;
      } catch (e) {
        this.profileError = e.message;
      } finally {
        this.profileBusy = false;
      }
    },
    async saveProfilePhone() {
      if (this.profileBusy) return;
      this.profileBusy = true;
      this.profileError = "";
      try {
        await accountRequest("/account/phone", {
          phone: this.newPhone,
          currentSecret: this.phoneSecret,
        });
        this.phoneSecret =
          this.currentSecret =
          this.secret =
          this.confirmSecret =
            "";
        this.phoneSaved = true;
      } catch (e) {
        this.profileError = e.message;
      } finally {
        this.profileBusy = false;
      }
    },
    async saveProfilePassword() {
      if (this.profileBusy) return;
      this.profileError = "";
      if (this.secret !== this.confirmSecret) {
        this.profileError = "Las contraseñas no coinciden.";
        return;
      }
      this.profileBusy = true;
      try {
        await accountRequest("/account/password", {
          currentSecret: this.currentSecret,
          secret: this.secret,
          confirmSecret: this.confirmSecret,
        });
        this.currentSecret = this.secret = this.confirmSecret = "";
        this.passwordSaved = true;
      } catch (e) {
        this.profileError = e.message;
      } finally {
        this.profileBusy = false;
      }
    },
  };
}
