## Prerequisites
Before running the game locally, make sure you have the following installed:

1. **Node.js:** Download and install the **LTS version** from [nodejs.org](https://nodejs.org/).
2. **Git:** Download and install Git from [git-scm.com](https://git-scm.com/) (if not already installed).

## Setup & Run Locally (Windows / Git Bash)

### Prerequisites
* **Node.js:** Download and install the **LTS version** from [nodejs.org](https://nodejs.org/).
* **Git:** Download and install Git (including *Git Bash*) from [git-scm.com](https://git-scm.com/).

### Installation & First Start (for beginners)

1. Open **Git Bash**.
2. Create the target folder `C:\Temp\Tennis` and navigate into it:
   ```bash
   mkdir -p /c/Temp/Tennis && cd /c/Temp/Tennis
3. Clone the repository from GitHub:
   ```bash
   git clone https://github.com/Galaxgwidon/Court-Smash-2D-Tennis-.git
4. Enter the newly created project folder:
   ```bash
   cd Court-Smash-2D-Tennis-
5. Install the required dependencies:
   ```bash
   npm install --legacy-peer-deps
6. Start the local server:
    ```bash
    npm run dev
7. Open your browser and go to http://localhost:3000 to play

### Starting the Game Again Later
1. You do not need to clone or install anything again. Simply open Git Bash and run:
   ```bash
   cd /c/Temp/Tennis/Court-Smash-2D-Tennis-
        npm run dev

### Key Bindings and How to play

#### Movement (WASD): You now move your player directly across the court using W / A / S / D (arrow keys still work alongside them as an option).

#### Shot Direction & Mouse Acceleration:
The mouse determines your target on the opponent's half—taking into account your current movement direction and acceleration (e.g., a fast mouse flick               forward and to the left pulls the shot noticeably sharper, lower, and with spin into the left corner, giving it an extra momentum bonus).
A subtle crosshair on the opponent's half continuously shows your calculated target, as well as the current power when swinging or charging up.

#### Left & Right Mouse Button (hold = sharper):
Left Mouse Button: Sharp shot just over the net—the longer you hold it down, the greater the speed and sharpness (releasing triggers the shot).
Right Mouse Button: Volley (the context menu is disabled on the court)—with extended mid-air reach for hitting the ball directly before it bounces; can also be charged by holding it down.

While holding the button, your player visibly winds up for the shot, accompanied by a curved power meter right next to the character.
