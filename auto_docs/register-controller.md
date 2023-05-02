# Register Controller Script Documentation - register-controller.js

This script registers a new controller with the AutoLoop Registrar contract, checks its registration status with the AutoLoop Registry, and verifies if it has been granted the controller role in the AutoLoop contract.

## Prerequisites

Ensure the following dependencies are installed and configured:

- `hardhat`
- `dotenv`
- AutoLoop ABI files and deployment information

## Usage

To run the script, execute the following command:

```sh
yarn register-controller
```

## Script Flow

1. Set up the provider and wallet using environment variables and configuration settings.
2. Create an instance of the AutoLoop Registrar contract using its ABI.
3. Check if the wallet address can be registered as a controller.
4. If registration is possible, call the `registerController()` function on the Registrar contract.
5. Create an instance of the AutoLoop Registry contract using its ABI.
6. Check if the wallet address is registered as a controller in the Registry contract.
7. Create an instance of the AutoLoop contract using its ABI.
8. Retrieve the `CONTROLLER_ROLE` constant from the AutoLoop contract.
9. Check if the wallet address has the controller role in the AutoLoop contract.

## Error Handling

The script logs error messages during the registration process, such as when registration is not possible or if an error occurs while calling the `registerController()` function.

If an error occurs during the execution of the main function, the error message is logged, and the process exits with a non-zero status code.
