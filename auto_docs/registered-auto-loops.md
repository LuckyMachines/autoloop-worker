# Get Registered AutoLoops Script Documentation - registered-auto-loops.js

This script retrieves the list of registered AutoLoops from the AutoLoop Registry contract.

## Prerequisites

Ensure the following dependencies are installed and configured:

- `hardhat`
- `dotenv`
- AutoLoop ABI files and deployment information

## Usage

To run the script, execute the following command:

```sh
yarn get-registered-autoloops
```

## Script Flow

1. Set up the provider and wallet using environment variables and configuration settings.
2. Create an instance of the AutoLoop Registry contract using its ABI.
3. Call the `getRegisteredAutoLoops()` function on the Registry contract to retrieve the list of registered AutoLoops.
4. Log the list of registered AutoLoops.

## Error Handling

If an error occurs during the execution of the main function, the error message is logged, and the process exits with a non-zero status code.
