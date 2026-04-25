Feature: Memory hub API behavior
  As a Claude Code session writing memories,
  I want the hub to enforce auth and reject unauthenticated writes,
  So that no session can write into another session's memory stream.

  Background:
    Given a fresh test session named "bdd-primary"

  Scenario: Authenticated POST creates a memory and returns its server-computed hash
    When I POST a memory with title "BDD-1" and content "hello"
    Then the response status is 201
    And the response body has a 64-character content_hash

  Scenario: Unauthenticated POST is rejected
    When I POST a memory with no bearer token
    Then the response status is 401

  Scenario: Server ignores client-supplied content_hash
    When I POST a memory with title "BDD-2" and a forged content_hash "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    Then the response status is 201
    And the response content_hash does not equal "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
