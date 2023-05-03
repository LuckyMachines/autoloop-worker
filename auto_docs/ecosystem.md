# AutoLoop Ecosystem Documentation

The AutoLoop Ecosystem consists of four contracts working together to facilitate an automated looping mechanism for other contracts. This documentation provides an overview of how these contracts interact with each other.

## Overview of Contracts

1. **AutoLoop**: The primary contract responsible for progressing loops on compatible contracts. It is permissioned, meaning only authorized controllers can call its functions.
2. **AutoLoopRegistry**: A contract that maintains a list of registered AutoLoops. It is permissioned and can only be updated by authorized registrars.
3. **AutoLoopRegistrar**: A contract that allows registering new controllers to the AutoLoopRegistry. It is permissioned and can only be updated by authorized admins.
4. **AutoLoopCompatibleInterface**: An interface that other contracts should implement to be compatible with the AutoLoop system. It specifies the necessary functions to be implemented for compatibility.

## Interaction of Contracts

### 1. Registering a Controller

A controller is an external entity (such as a script or a user) that has permission to call the `progressLoop()` function on the AutoLoop contract.

- The controller first checks with the AutoLoopRegistrar contract if it can register itself using the `canRegisterController()` function.
- If the controller is allowed to register, it calls the `registerController()` function on the AutoLoopRegistrar contract.
- The AutoLoopRegistrar updates the AutoLoopRegistry contract with the new controller's information.

### 2. Registering a Compatible Contract

For a contract to be compatible with the AutoLoop system, it must implement the AutoLoopCompatibleInterface.

- The compatible contract should register itself with the AutoLoopRegistry to be part of the AutoLoop Ecosystem.
- The AutoLoopRegistry keeps track of all registered compatible contracts.

### 3. Progressing a Loop

The primary purpose of the AutoLoop contract is to progress loops on compatible contracts.

- A registered controller calls the `shouldProgressLoop()` function on a compatible contract to check if the loop needs to be progressed.
- If the loop needs to be progressed, the controller calls the `progressLoop()` function on the AutoLoop contract, passing the contract address and any necessary data as arguments.
- The AutoLoop contract calls the `progressLoop()` function on the compatible contract to progress the loop and ensure the gas limit and other requirements are met.

## Summary

The AutoLoop Ecosystem provides a decentralized and permissioned way of managing and progressing loops on compatible contracts. The interaction between AutoLoop, AutoLoopRegistry, AutoLoopRegistrar, and AutoLoopCompatibleInterface ensures a secure and modular approach to managing the looping mechanism.
