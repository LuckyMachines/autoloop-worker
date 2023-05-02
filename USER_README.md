# AutoLoop Worker

The AutoLoop Worker is a Node.js application designed to automate looping mechanisms for smart contracts within the AutoLoop Ecosystem. It interacts with registered contracts and controllers, providing a permissioned and modular approach to managing loops.

## Features

- Automated loop progression for compatible smart contracts
- Permissioned system for secure interaction with registered controllers
- Modular design for easy integration with existing projects

## Getting Started

To get started with the AutoLoop Worker, follow the instructions below:

### Prerequisites

Ensure that you have [Node.js](https://nodejs.org/) installed on your machine.

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/LuckyMachines/autoloop
   ```
2. Navigate to the project directory:
   ```
   cd autoloop
   ```
3. Install the required dependencies:
   ```
   npm install
   ```

## Usage

The AutoLoop Worker comes with several npm scripts to help you interact with the AutoLoop Ecosystem:

- **progress-loop**: Progress a loop on a specific contract by calling the `progress-loop.js` script.
  ```
  npm run progress-loop <CONTRACT_ADDRESS>
  ```
- **register-controller**: Register your wallet address as a controller with the `register-controller.js` script.
  ```
  npm run register-controller
  ```
- **start**: Start the AutoLoop Worker with the `worker.js` script.
  ```
  npm run start
  ```
- **cloud-start**: Register your wallet address as a controller and start the AutoLoop Worker with the `worker.js` script.
  ```
  npm run cloud-start
  ```

## Contributing

If you'd like to contribute to the AutoLoop Worker project, feel free to submit a pull request or open an issue on the [GitHub repository](https://github.com/LuckyMachines/autoloop).

## License

## Support

If you encounter any issues or need help, please submit an issue on the [GitHub repository](https://github.com/LuckyMachines/autoloop/issues).
